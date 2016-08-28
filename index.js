var AWS = require('aws-sdk')
var defaults = require('merge-defaults')
var assert = require('assert')
var util = require('util')
var path = require('path')
var url = require('url')
var cloudfront = require('cloudfront-tls')
var diff = require('deep-diff').diff
var assign = require('object-assign')
var fs = require('fs')
var mime = require('mime')
require('dotenv').config({ silent: true })
var s3diff = require('s3-diff')
var logUpdate = require('log-update')

var defaultConfig = {
  index: 'index.html',
  region: 'us-east-1',
  uploadDir: '.'
}

var defaultBucketConfig = {
  Bucket: '' /* required */
}

var defaultWebsiteConfig = {
  Bucket: '', /* required */
  WebsiteConfiguration: { /* required */
    IndexDocument: {
      Suffix: defaultConfig.index /* required */
    }
  }
}

function s3site (config, cb) {
  if (typeof cb !== 'function') cb = function () {}

  assert(typeof config === 'object')
  assert(typeof config.domain === 'string')

  config = defaults(config, defaultConfig)

  var bucketConfig = defaults(config.bucketConfig || {}, defaultBucketConfig)
  var websiteConfig = defaults(config.websiteConfig || {}, defaultWebsiteConfig)

  if (config.domain) {
    bucketConfig.Bucket = config.domain
    websiteConfig.Bucket = config.domain
  }

  if (config.region && config.region !== 'us-east-1') { // LocationConstraint for default location is invalid
    bucketConfig.CreateBucketConfiguration = { LocationConstraint: config.region }
  } else {
    config.region = defaultConfig.region
  }

  if (config.redirectall) {
    websiteConfig.WebsiteConfiguration = {
      RedirectAllRequestsTo: { HostName: config.redirectall }
    }
  }

  if (config.index && !config.redirectall) {
    websiteConfig.WebsiteConfiguration.IndexDocument.Suffix = config.index
  }

  if (config.error && !config.redirectall) {
    websiteConfig.WebsiteConfiguration.ErrorDocument = { Key: config.error }
  }

  if (config.routes && !config.redirectall) {
    websiteConfig.WebsiteConfiguration.RoutingRules = loadRoutes(config.routes)
  }

  var s3 = new AWS.S3({ region: config.region })

  s3.createBucket(bucketConfig, function (err, bucket) {
    if (err && err.code !== 'BucketAlreadyOwnedByYou') return cb(err)

    setPolicy(s3, config.domain, function (err) {
      if (err) return cb(err)
      createWebsite(s3, websiteConfig, config, function (err, website) {
        if (err) return cb(err)

        if (config.cert || config.certId) {
          config.aliases = config.aliases || [ config.domain ]
          config.origin = url.parse(website.url).host

          cloudfront(config, function (err, distribution) {
            if (err) return cb(err)

            website.url = 'http://' + distribution.url
            website.certId = distribution.certId
            website.cloudfront = distribution.distribution

            if (config.deploy) {
              return putWebsiteContent(s3, config, function (err, uploadResults) {
                cb(err, website, uploadResults)
              })
            }
            cb(null, website, {})
          })
        } else {
          if (config.deploy) {
            return putWebsiteContent(s3, config, function (err, website, uploadResults) {
              cb(err, website, uploadResults)
            })
          }
          cb(null, website, {})
        }
      })
    })
  })
}

function parseWebsite (website, modified, config) {
  var host

  // Frankfurt has a slightly differnt URL scheme :(
  if (config.region === 'eu-central-1') {
    host = [config.domain, 's3-website', config.region, 'amazonaws.com'].join('.')
  } else {
    host = [config.domain, 's3-website-' + config.region, 'amazonaws.com'].join('.')
  }

  var siteUrl = url.format({
    protocol: 'http',
    host: host
  })

  return {
    url: siteUrl,
    config: website,
    modified: !!modified
  }
}

function createWebsite (s3, websiteConfig, config, cb) {
  function putWebsite () {
    s3.putBucketWebsite(websiteConfig, function (err, website) {
      if (err) return cb(err)

      s3.getBucketWebsite({ Bucket: config.domain }, function (err, website) {
        if (err) return cb(err)
        cb(null, parseWebsite(website, true, config))
      })
    })
  }

  s3.getBucketWebsite({ Bucket: config.domain }, function (err, website) { // eslint-disable-line handle-callback-err
    var dirty = diff(website || {}, websiteConfig.WebsiteConfiguration)
    if (dirty) {
      putWebsite()
    } else {
      cb(null, parseWebsite(website, null, config))
    }
  })
}

// sets up a public-read bucket policy
function setPolicy (s3, bucket, cb) {
  var publicRead = {
    Sid: 'AddPublicReadPermissions',
    Effect: 'Allow',
    Principal: '*',
    Action: 's3:GetObject',
    Resource: 'arn:aws:s3:::' + bucket + '/*'
  }

  s3.getBucketPolicy({ Bucket: bucket }, function (err, data) {
    if (err && err.code !== 'NoSuchBucketPolicy') return cb(err)

    var newPolicy = { Statement: [] }
    var oldPolicy

    try {
      oldPolicy = JSON.parse(data.Policy)
    } catch (err) {}

    var found = false

    if (oldPolicy) {
      newPolicy.Statement = oldPolicy.Statement.map(function (item) {
        if (item.Sid === 'AddPublicReadPermissions') {
          found = true
          return publicRead
        }
        return item
      })
    }

    if (!found) newPolicy.Statement.push(publicRead)

    var dirty = diff(oldPolicy || {}, newPolicy, function (path, key) {
      if (key === 'Version') return true
    })

    if (dirty) {
      var policy = assign(oldPolicy || {}, newPolicy)
      s3.putBucketPolicy({ Bucket: bucket, Policy: JSON.stringify(policy) }, cb)
    } else {
      process.nextTick(cb)
    }
  })
}

function loadRoutes (routesOrFile) {
  var routes
  if (typeof routesOrFile === 'string') {
    routes = require(path.resolve(__dirname, routesOrFile))
  } else {
    routes = routesOrFile
  }

  validateRoutes(routes)
  return routes
}

function validateRoutes (routes) {
  assert(Array.isArray(routes), 'Routes must be an array')

  var validProperties = {
    Condition: {
      HttpErrorCodeReturnedEquals: true,
      KeyPrefixEquals: true
    },
    Redirect: {
      HostName: true,
      Protocol: true,
      ReplaceKeyPrefixWith: true,
      ReplaceKeyWith: true,
      HttpRedirectCode: true
    }
  }

  routes.forEach(function (route, idx) {
    validateProps(route, validProperties)
    validateProps(route.Condition, validProperties.Condition)
    validateProps(route.Redirect, validProperties.Redirect)
  })
}

function validateProps (obj, props, idx) {
  var keys = Object.keys(obj)
  assert(keys.length > 0, util.format('Invalid route at index %s', idx))
  keys.forEach(function (key) {
    assert(props[key], util.format('Invalid route property %s at index %s', key, idx))
  })
}

function getConfig (path, fromCL, cb) {
  fs.readFile(path, function (err, data) {
    var fromFile
    try {
      fromFile = JSON.parse(data) // Read data from file
    } catch (e) {
      fromFile = {}
    }

    var dirty = Object.keys(fromCL).some(function (key) { // Test if anything has changed
      return fromFile[key] !== fromCL[key]
    })

    var config = Object.assign(defaultConfig, fromFile, fromCL) // Merge arguments and file parameters

    if (!config.domain) {
      console.log('No bucket was specified. Check your config file .s3-website.json')
      return
    }

    if (dirty && !config.lockConfig) { // Something has changed rewrite file, and we are allowed to write config file
      fs.writeFile('.s3-website.json', JSON.stringify(config), function (err) {
        if (err) console.error(err)
        console.log('Updated config file: .s3-website.json')
        cb(err, config)
      })
    } else { // No change, we're done
      cb(err, config)
    }
  })
}

function deleteFile (s3, config, file, cb) {
  var params = {
    Bucket: config.domain,
    Key: file
  }
  logUpdate('Removing: ' + file)
  s3.deleteObject(params, function (err, data) {
    if (err && cb) { return cb(err) }
    if (cb) { cb(err, data, file) }
  })
}

function uploadFile (s3, config, file, cb) {
  var params = {
    Bucket: config.domain,
    Key: file,
    Body: fs.createReadStream(path.join(config.uploadDir, file)),
    ContentType: mime.lookup(file)
  }

  logUpdate('Uploading: ' + file)
  s3.putObject(params, function (err, data) {
    if (err && cb) { return cb(err) }
    if (cb) { cb(err, data, file) }
  })
}

function checkDone (allFiles, results, cb) {
  var files = [allFiles.missing, allFiles.changed, allFiles.extra]
  var finished = [results.uploaded, results.updated, results.removed, results.errors]
  var totalFiles = files.reduce(function (prev, current) {
    return prev.concat(current)
  }, []).length
  var fileResults = finished.reduce(function (prev, current) {
    return prev.concat(current)
  }, []).length

  if (fileResults >= totalFiles && cb) {
    if (totalFiles > 0) { logUpdate('Done Uploading') }
    cb(null, results)
  }
}

function putWebsiteContent (s3, config, cb) {
  if (typeof cb !== 'function') { cb = function () {} }

  s3diff({
    aws: {
      signatureVersion: 'v4'
    },
    local: config.uploadDir || '.',
    remote: {
      bucket: config.domain,
      prefix: ''
    },
    recursive: true
  }, function (err, data) {
    if (err) return cb(err)
    var results = {
      uploaded: [],
      updated: [],
      removed: [],
      errors: []
    }

    function logResults (err, results) {
      if (err) { return cb(err) }
      var params = { Bucket: config.domain }
      s3.getBucketWebsite(params, function (err, website) {
        if (err) { return cb(err) }
        cb(err, parseWebsite(website, null, config), results)
      })
    }

    // Delete files that exist on s3, but not locally
    data.missing.forEach(function (file) {
      deleteFile(s3, config, file, function (err, fileData, file) {
        if (err) { return results.errors.push(err) }
        results.removed.push(file)
        checkDone(data, results, logResults)
      })
    })

    // Upload changed files
    data.changed.forEach(function (file) {
      uploadFile(s3, config, file, function (err, fileData, file) {
        if (err) { return results.errors.push(err) }
        results.updated.push(file)
        checkDone(data, results, logResults)
      })
    })

    // Upload files that exist locally but not on s3
    data.extra.forEach(function (file) {
      uploadFile(s3, config, file, function (err, fileData, file) {
        if (err) { return results.errors.push(err) }
        results.uploaded.push(file)
        checkDone(data, results, logResults)
      })
    })
    checkDone(data, results, logResults)
  })
}

module.exports = {
  s3site: s3site,
  deploy: putWebsiteContent,
  config: getConfig
}
