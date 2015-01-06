var test = require('tape')
var supertest = require('supertest')
var s3site = require('../')
var AWS = require('aws-sdk')

var config = {
  region: 'eu-central-1',
  domain: 's3-website-test-' + Math.ceil(Math.random() * 10)
}

test('create website', function(t) {
  s3site(config, function(err, website) {
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

test('update website', function(t) {
  config.index = 'foo.html'
  config.error = '404.html'

  s3site(config, function(err, website) {
    if (err) cleanup(config.domain)
    t.error(err, 'website updated')
    t.equal(website.config.IndexDocument.Suffix, 'foo.html')
    t.equal(website.config.ErrorDocument.Key, '404.html')

    cleanup(config.domain, function() {
      t.pass('deleted ' + config.domain)
      t.end()
    })
  })
})

function cleanup (bucket, cb) {
  var s3 = new AWS.S3({ region: config.region })

  s3.deleteObject({ Bucket: config.domain, Key: 'index.html' }, function(err) {
    s3.deleteBucket({ Bucket: bucket }, function(err, data) {
      if (err) throw err
      if (cb) cb()
    })
  })
}