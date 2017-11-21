var AWS = require('aws-sdk')
var defaults = require('merge-defaults')
var assert = require('assert')
var util = require('util')
var path = require('path')
var url = require('url')
var cloudfront = require('cloudfront-tls')
var diff = require('deep-diff').diff
var assign = require('object-assign')
var fs = require('graceful-fs')
var mime = require('mime')
require('dotenv').config({ silent: true })
var s3diff = require('s3-diff')
var wildcard = require('wildcard')
var logUpdate = require('log-update')
var array = require('lodash/array')

var defaultConfig = {
  index: 'index.html',
  region: 'us-east-1',
  uploadDir: '.',
  prefix: '',
  exclude: [],
  corsConfiguration: [],
  enableCloudfront: false,
  retries: 20
}

var templateConfig = Object.assign({},
  defaultConfig,
  {
    domain: 'sample.bucket.name',
    corsConfiguration: [{
      AllowedMethods: [ /* required */
        'STRING_VALUE_REQUIRED'
        /* more items */
      ],
      AllowedOrigins: [ /* required */
        'STRING_VALUE_REQUIRED'
        /* more items */
      ],
      AllowedHeaders: [
        'STRING_VALUE'
        /* more items */
      ],
      ExposeHeaders: [
        'STRING_VALUE'
        /* more items */
      ],
      MaxAgeSeconds: 0
    }]
  }
)

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

// Perform an action on an array of items, action will be invoked again after
// the prior item has finished
function sequentially (s3, config, action, files, cb, results = {done: [], errors: []}) {
  const index = results.done.length + results.errors.length
  action(s3, config, files[index], function (err, data, file) {
    if (err) {
      results.errors.push(file)
    } else {
      results.done.push(file)
    }

    if (index === files.length - 1) {
      return cb(err, data, results)
    }
    sequentially(s3, config, action, files, cb, results)
  })
}

function mergeResults (oldResult, newResult) {
  var updated = oldResult.updated.concat(newResult.updated)
  var uploaded = oldResult.uploaded.concat(newResult.uploaded)
  var removed = oldResult.removed.concat(newResult.removed)
  var errors = newResult.errors

  return {
    updated: array.uniq(updated),
    uploaded: array.uniq(uploaded),
    removed: array.uniq(removed),
    errors: errors
  }
}

function retry (s3, config, allFiles, currentResults, cb) {
  var results = {
    updated: [],
    uploaded: [],
    removed: [],
    errors: []
  }

  var retryFiles = {
    missing: [],
    changed: [],
    extra: currentResults.errors
  }

  function deletionDone (err, data, file) {
    if (err) {
      results.errors.push(file)
    } else {
      results.removed.push(file)
    }
    checkDone(retryFiles, results, function (err, results) {
      cb(err, mergeResults(currentResults, results))
    })
  }

  function uploadDone (err, data, file) {
    if (err) {
      results.errors.push(file)
    } else {
      results.uploaded.push(file)
    }
    checkDone(retryFiles, results, function (err, results) {
      cb(err, mergeResults(currentResults, results))
    })
  }

  logUpdate('Retrying failed actions')
  currentResults.errors.forEach(function (error) {
    if (allFiles.missing.find(function (file) { return file === error })) {
      deleteFile(s3, config, error, deletionDone)
    } else {
      uploadFile(s3, config, error, uploadDone)
    }
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

  logUpdate('Finished Uploading ' + fileResults + ' of ' + totalFiles)
  if (fileResults >= totalFiles && cb) {
    if (results.errors.length > 0) { }
    if (totalFiles > 0) { logUpdate('Done Uploading') }
    cb(null, results)
  }
}

function deleteFile (s3, config, file, cb) {
  var params = {
    Bucket: config.domain,
    Key: normalizeKey(config.prefix, file)
  }
  logUpdate('Removing: ' + file)
  s3.deleteObject(params, function (err, data) {
    if (err && cb) { return cb(err, data, file) }
    if (cb) { cb(err, data, file) }
  })
}

function getExtension (file) {
  const spl = file.split('.')
  return spl.length > 0 && spl[spl.length - 1]
}

function uploadFile (s3, config, file, cb) {
  const ext = getExtension(file)
  const contentType = config.contentTypes && config.contentTypes[ext]

  var params = {
    Bucket: config.domain,
    Key: normalizeKey(config.prefix, file),
    Body: fs.createReadStream(path.join(config.uploadDir, file)),
    ContentType: contentType || mime.lookup(file),
    CacheControl: (config.cacheControl != null) ? config.cacheControl : null
  }

  logUpdate('Uploading: ' + file)
  s3.putObject(params, function (err, data) {
    if (err && cb) { return cb(err, data, file) }
    if (cb) { cb(err, data, file) }
  })
}

function chunkedAction (s3, config, action, arr, cb) {
  var result = {
    done: [],
    errors: []
  }

  var numWorkers = 200
  var chunkSize = Math.ceil(arr.length / numWorkers)
  var chunks = array.chunk(arr, chunkSize)
  chunks.forEach(function (chunk) {
    new Promise(function (resolve, reject) {
      action(s3, config, chunk, function (err, data, results) {
        if (err) { console.error(err) }

        result.done = result.done.concat(results.done)
        result.errors = result.errors.concat(results.errors)

        var numFinished = result.done.length + result.errors.length
        if (numFinished === arr.length) { cb(err, data, result) }
        resolve()
      })
    }).catch(function (e) { console.error(e) })
  })

  return result
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

  var s3 = new AWS.S3({ region: config.region, maxRetries: config.retries })

  s3.createBucket(bucketConfig, function (err, bucket) {
    if (err && err.code !== 'BucketAlreadyOwnedByYou') return cb(err)

    setPolicy(s3, config.domain, function (err) {
      if (err) return cb(err)
      createWebsite(s3, websiteConfig, config, function (err, website) {
        if (err) return cb(err)

        if (config.corsConfiguration.length > 0) {
          setCorsRules(s3, config.domain, config.corsConfiguration, function (err, data) {
            if (err) console.error(err)
          })
        }

        if (config.enableCloudfront || config.cert || config.certId) {
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

  // Some region has a slightly differnt URL scheme :(
  var dotEndpointRegions = ['us-east-2', 'ca-central-1', 'ap-south-1', 'ap-northeast-2', 'eu-central-1', 'eu-west-2']
  var hasDifferentScheme = dotEndpointRegions.find(function (region) {
    return region === config.region
  })

  if (hasDifferentScheme) {
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

function setCorsRules (s3, bucket, rules, cb) {
  var s3Params = {
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: rules
    }
  }
  s3.putBucketCors(s3Params, function (err, data) {
    if (cb) { cb(err, data) }
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
      console.log('No bucket was specified. Check your config file ' + path)
      return
    }

    if (dirty && !config.lockConfig) { // Something has changed rewrite file, and we are allowed to write config file
      fs.writeFile(fromCL.configFile, JSON.stringify(config, null, 3), function (err) {
        if (err) console.error(err)
        console.log('Updated config file: ' + fromCL.configFile)
        cb(err, config)
      })
    } else { // No change, we're done
      cb(err, config)
    }
  })
}

function normalizePath (path) {
  return path.replace(/\\/g, '/')
}

function normalizeKey (prefix, key) {
  return normalizePath(prefix ? prefix + '/' + key : key)
}

function deleteFiles (s3, config, files, cb, results = {done: [], errors: []}) {
  sequentially(s3, config, deleteFile, files, cb)
}

function uploadFiles (s3, config, files, cb, results = {done: [], errors: []}) {
  sequentially(s3, config, uploadFile, files, cb)
}

function putWebsiteContent (s3, config, cb) {
  if (typeof cb !== 'function') { cb = function () {} }

  config = defaults(config, defaultConfig)

  s3diff({
    aws: {
      signatureVersion: 'v4'
    },
    local: config.uploadDir || '.',
    remote: {
      bucket: config.domain,
      prefix: config.prefix
    },
    recursive: true
  }, function (err, data) {
    if (err) return cb(err)

    // exclude files from the diff
    config.exclude.forEach(function (excludePattern) {
      for (var key in data) {
        data[key] = data[key].filter(function (path) {
          return !wildcard(excludePattern, path)
        })
      }
    })

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

    function handleRetry (err, results) {
      if (results.errors.length > 0) {
        retry(s3, config, data, results, logResults)
        return
      }
      logResults(err, results)
    }

    // Delete files that exist on s3, but not locally
    chunkedAction(
       s3,
       config,
       deleteFiles,
       data.missing,
       function (err, eTags, result) {
         if (err) { console.error(err) }
         results.removed = results.removed.concat(result.done)
         results.errors = results.errors.concat(result.errors)
         checkDone(data, results, handleRetry)
       })

    // Upload changed files
    chunkedAction(
       s3,
       config,
       uploadFiles,
       data.changed,
       function (err, eTags, result) {
         if (err) { console.error(err) }
         results.updated = results.updated.concat(result.done)
         results.errors = results.errors.concat(result.errors)
         checkDone(data, results, handleRetry)
       })

     // Upload files that exist locally but not on s3
    chunkedAction(
       s3,
       config,
       uploadFiles,
       data.extra,
       function (err, eTags, result) {
         if (err) { console.error(err) }
         results.uploaded = results.uploaded.concat(result.done)
         results.errors = results.errors.concat(result.errors)
         checkDone(data, results, handleRetry)
       })

    checkDone(data, results, handleRetry)
  })
}

var utilities = {
  retry: retry,
  sequentially: sequentially,
  chunkedAction: chunkedAction,
  checkDone: checkDone
}

module.exports = {
  utils: utilities,
  s3site: s3site,
  deploy: putWebsiteContent,
  config: getConfig,
  templateConfig: templateConfig
}
