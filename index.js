var AWS = require('aws-sdk')
var defaults = require('merge-defaults')
var assert = require('assert')
var url = require('url')

var defaultConfig = {
  index: 'index.html'
}

var defaultBucketConfig = {
  Bucket: '', /* required */
  ACL: 'public-read'
}

var defaultWebsiteConfig = {
  Bucket: '', /* required */
  WebsiteConfiguration: { /* required */
    IndexDocument: {
      Suffix: 'index.html' /* required */
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
    if (err && err.code !== 'BucketAlreadyOwnedByYou') {
      return cb(err)
    }

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
  })

  // var params = {
  //   Bucket: 'STRING_VALUE' /* required */
  // };
  // s3.getBucketWebsite(params, function(err, data) {
  //   if (err) console.log(err, err.stack); // an error occurred
  //   else     console.log(data);           // successful response
  // })
}