var AWS = require('aws-sdk')
var defaults = require('merge-defaults')
var assert = require('assert')
var url = require('url')

var defaultConfig = {
  index: 'index.html'
}

var defaultBucketConfig = {
  Bucket: '', /* required */
}

var defaultWebsiteConfig = {
  Bucket: '', /* required */
  WebsiteConfiguration: { /* required */
    IndexDocument: {
      Suffix: defaultConfig.index /* required */
    }
  }
}

module.exports = function(config, cb) {
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

  if (config.region) {
    bucketConfig.CreateBucketConfiguration = { LocationConstraint: config.region }
  } else {
    config.region = 'us-east-1'
  }

  if (config.index) {
    websiteConfig.WebsiteConfiguration.IndexDocument.Suffix = config.index
  }

  if (config.error) {
    websiteConfig.WebsiteConfiguration.ErrorDocument = { Key: config.error }
  }

  var s3 = new AWS.S3({ region: config.region })

  s3.createBucket(bucketConfig, function(err, bucket) {
    if (err && err.code !== 'BucketAlreadyOwnedByYou') return cb(err)

    setPolicy(s3, config.domain, function(err) {
      if (err) return cb(err)
      createWebsite(s3, websiteConfig, config, cb)
    })
  })
}

function createWebsite (s3, websiteConfig, config, cb) {
  s3.putBucketWebsite(websiteConfig, function(err, website) {
    if (err) return cb(err)

    s3.getBucketWebsite({ Bucket: config.domain }, function(err, website) {
      if (err) return cb(err)

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

      cb(null, { url: siteUrl, config: website })
    })
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

  s3.getBucketPolicy({ Bucket: bucket }, function(err, data) {
    if (err && err.code !== 'NoSuchBucketPolicy') return cb(err)

    var policy = {
      Statement: []
    }

    try {
      policy = JSON.parse(data.Policy)
    } catch (err) {}

    var found = false

    policy.Statement = policy.Statement.map(function(item) {
      if (item.Sid === 'AddPublicReadPermissions') {
        found = true
        return publicRead
      } else {
        return item
      }
    })

    if (!found) policy.Statement.push(publicRead)

    s3.putBucketPolicy({ Bucket: bucket, Policy: JSON.stringify(policy) }, cb)
  })
}
