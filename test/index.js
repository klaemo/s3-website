var test = require('tape')
var supertest = require('supertest')
var s3site = require('../').s3site
var s3Utils = require('../').utils
var AWS = require('aws-sdk')

var config = {
  region: 'eu-central-1', // us-east-1
  domain: 's3-website-test-' + Math.random().toString(16).slice(2),
  routes: [{
    Condition: {
      KeyPrefixEquals: 'foo/'
    },
    Redirect: {
      HostName: 'example.com'
    }
  }]
}

test('create website', function (t) {
  s3site(config, function (err, website) {
    if (err) cleanup(config.domain)

    t.error(err, 'no error')
    t.ok(website, 'website created')
    t.equal(typeof website.url, 'string', 'has website url')
    t.equal(typeof website.config, 'object', 'has website config')

    var s3 = new AWS.S3({ region: config.region })

    // check if website works
    s3.putObject({
      Bucket: config.domain,
      Key: 'index.html',
      ACL: 'public-read',
      Body: '<h1>Foo</h1>',
      ContentType: 'text/html'
    }, function (err) {
      t.error(err, 'no error')
      supertest(website.url).get('/')
        .expect(200)
        .expect('content-type', /html/)
        .expect(/Foo/)
        .end(t.end)
    })
  })
})

test('upload content', function (t) {
  config.uploadDir = './test/fixtures'
  config.deploy = true
  config.index = 'test-upload.html'

  // Check if content from upload directory exists
  s3site(config, function (err, website) {
    if (err) cleanup(config.domain)
    t.error(err, 'website uploaded')
    supertest(website.url).get('/test-upload.html')
        .expect(200)
        .expect('content-type', /html/)
        .expect(/Howdy/)
        .end(t.end)
  })
})

test('create www redirect', function (t) {
  var subdomain = 'www.' + config.domain
  var destination = 'http://' + config.domain + '/'

  s3site({
    region: config.region,
    domain: subdomain,
    redirectall: config.domain
  }, function (err, website) {
    if (err) cleanup(subdomain)
    t.error(err, 'redirect configured')
    t.equal(website.config.RedirectAllRequestsTo.HostName, config.domain)

    // check if redirect works
    supertest(website.url).get('/')
      .expect(301)
      .expect('content-length', '0')
      .expect('location', destination)
      .end(function (err, res) {
        if (err) cleanup(subdomain)
        t.error(err, 'redirect working')
        cleanup(subdomain, function () {
          t.pass('deleted ' + subdomain)
          t.end()
        })
      })
  })
})

test('update only changed files', function (t) {
  config.uploadDir = './test/fixtures'
  config.index = 'test-upload.html'
  s3site(config, function (err, website, results) {
    if (err) cleanup(config.domain)
    var shouldUpload = ['another/anotherFile.txt', 'test-upload.html', 'another.txt']
    t.deepEqual(results.updated, []) // Nothing should be updated
    t.deepEqual(results.removed, []) // Nothing should be removed
    t.deepEqual(results.errors, []) // No errors should have occured
    shouldUpload.forEach(function (file) { // each file in shouldUpload should have been uploaded
      var result = results.uploaded.findIndex(function (uploaded) {
        return uploaded === file
      })
      t.true(result > -1)
    })

    s3site(config, function (err, website, results) {
      if (err) cleanup(config.domain)
      t.deepEqual(results, {
        uploaded: [], // No files have changed, so nothing should upload
        updated: [],
        removed: [],
        errors: []
      })
      t.end()
    })
  })
})

test('upload content with prefix', function (t) {
  config.uploadDir = './test/fixtures'
  config.deploy = true
  config.index = 'test-upload.html'
  config.prefix = 'prefix/folder'

  // Check if content from upload directory exists
  s3site(config, function (err, website) {
    if (err) cleanup(config.domain)
    t.error(err, 'website uploaded')
    supertest(website.url).get('/prefix/folder/test-upload.html')
      .expect(200)
      .expect('content-type', /html/)
      .expect(/Howdy/)
      .end(t.end)
  })
})

test('rollback website with previous prefix path excluded', function (t) {
  config.prefix = ''
  config.exclude = ['prefix/folder/*']

  s3site(config, function (err, website) {
    if (err) cleanup(config.domain)
    t.error(err, 'website rolled back')
    console.log(website.url)
    setTimeout(function () {
      supertest(website.url).get('/prefix/folder/another.txt')
        .expect(200)
        .expect('content-type', /text/)
        .expect(/Test upload file/)
        .end(t.end)
    }, 2000)
  })
})

test('update website', function (t) {
  config.index = 'foo.html'
  config.error = '404.html'

  s3site(config, function (err, website) {
    if (err) cleanup(config.domain)
    t.error(err, 'website updated')
    t.equal(website.config.IndexDocument.Suffix, 'foo.html')
    t.equal(website.config.ErrorDocument.Key, '404.html')

    cleanup(config.domain, function () {
      t.pass('deleted ' + config.domain)
      t.end()
    })
  })
})

test('sequentially', function (t) {
  var counter = 0
  var action = function (s3, config, file, cb) {
    counter++
    cb()
  }
  var arr = [1, 2, 3, 4, 5]

  s3Utils.sequentially(null, null, action, arr, function () {
    t.equal(counter, 5)
    t.end()
  })
})

function cleanup (bucket, cb) {
  var s3 = new AWS.S3({ region: config.region })

  s3.deleteObjects({
    Bucket: config.domain,
    Delete: {
      Objects: [
        {Key: 'index.html'},
        {Key: 'test-upload.html'},
        {Key: 'another.txt'},
        {Key: 'another/anotherFile.txt'},
        {Key: 'prefix/folder/index.html'},
        {Key: 'prefix/folder/test-upload.html'},
        {Key: 'prefix/folder/another.txt'},
        {Key: 'prefix/folder/another/anotherFile.txt'}
      ]
    }
  }, function (err) { // eslint-disable-line handle-callback-err
    s3.deleteBucket({ Bucket: bucket }, function (err, data) {
      if (err) throw err
      if (cb) cb()
    })
  })
}
