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
var glob = require('glob')
var mime = require('mime')
var dotenv = require('dotenv').config({silent:true});

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

function s3site(config, cb) {
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

  s3.createBucket(bucketConfig, function(err, bucket) {
    if (err && err.code !== 'BucketAlreadyOwnedByYou') return cb(err)

    setPolicy(s3, config.domain, function(err) {
      if (err) return cb(err)
      createWebsite(s3, websiteConfig, config, function(err, website) {
        if (err) return cb(err)

        if (config.cert || config.certId) {
          config.aliases = config.aliases || [ config.domain ]
          config.origin = url.parse(website.url).host

          cloudfront(config, function(err, distribution) {
            if (err) return cb(err)

            website.url = 'http://' + distribution.url
            website.certId = distribution.certId
            website.cloudfront = distribution.distribution

            writeConfig(config, function(err){
              if(err) return console.error("Error:" + err.message)
              console.log("Wrote config file: .s3-website.json")
            })

            if(config.uploadDir){
              return putWebsiteContent(s3, config, function(err){cb(err, website);})
            }
            cb(null, website)
          })
        } else {

          writeConfig(config, function(err){
              if(err) return console.error("Error:" + err.message)
              console.log("Wrote config file: .s3-website.json")
          })

          if(config.uploadDir){
            return putWebsiteContent(s3, config, function(err){cb(err, website);})
          }
          cb(null, website)
        }
      })
    })
  })
}

function createWebsite (s3, websiteConfig, config, cb) {

  function parseWebsite(website, modified) {
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
      modified: modified ? true : false
    }
  }

  function putWebsite() {
    s3.putBucketWebsite(websiteConfig, function(err, website) {
      if (err) return cb(err)

      s3.getBucketWebsite({ Bucket: config.domain }, function(err, website) {
        if (err) return cb(err)
        cb(null, parseWebsite(website, true))
      })
    })
  }

  s3.getBucketWebsite({ Bucket: config.domain }, function(err, website) {
    var dirty = diff(website || {}, websiteConfig.WebsiteConfiguration)
    if (dirty) {
      putWebsite()
    } else {
      cb(null, parseWebsite(website))
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

  s3.getBucketPolicy({ Bucket: bucket }, function(err, data) {
    if (err && err.code !== 'NoSuchBucketPolicy') return cb(err)

    var newPolicy = { Statement: [] }
    var oldPolicy

    try {
      oldPolicy = JSON.parse(data.Policy)
    } catch (err) {}

    var found = false

    if (oldPolicy) {
      newPolicy.Statement = oldPolicy.Statement.map(function(item) {
        if (item.Sid === 'AddPublicReadPermissions') {
          found = true
          return publicRead
        }
        return item
      })
    }

    if (!found) newPolicy.Statement.push(publicRead)

    var dirty = diff(oldPolicy || {}, newPolicy, function(path, key) {
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

function loadRoutes(routesOrFile) {
  var routes
  if (typeof routesOrFile === 'string') {
    routes = require(path.resolve(__dirname, routesOrFile))
  } else {
    routes = routesOrFile
  }

  validateRoutes(routes)
  return routes
}

function validateRoutes(routes) {
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

function validateProps(obj, props, idx) {
  var keys = Object.keys(obj)
  assert(keys.length > 0, util.format('Invalid route at index %s', idx))
  keys.forEach(function (key) {
    assert(props[key], util.format('Invalid route property %s at index %s', key, idx))
  })
}

function writeConfig(config, cb){
  if(typeof cb !== "function"){cb = function(){}}
  settings = {}
  if(config.domain) settings['domain'] = config.domain
  if(config.region) settings['region'] = config.region
  if(config.uploadDir) settings['uploadDir'] = config.uploadDir

  fs.writeFile(".s3-website.json", JSON.stringify(settings), cb);
}

function getConfig(path, cb){
  fs.readFile(path, function(err, data){
    try{data = JSON.parse(data);}
    catch(e){}
    cb(err, data);
  });
}

//TODO call upload file with each file from diff
function uploadFile(s3, config, file, cb){
  var params = {
    Bucket: config.domain,
    Key: path.relative(config.uploadDir, file),
    Body: fs.createReadStream(file),
    ContentType: mime.lookup(file)
  }
  s3.putObject(params, function(err, data){
    if(err && cb){return cb(err);}
    if(cb){cb(err, data, file);}
  });
}

function putWebsiteContent(s3, config, cb){
  if(typeof cb !== "function"){cb = function(){}}

  var options = {};
  var pattern = (config.uploadDir || '.') + "/**/*";
  var s3diff = require('s3-diff');
    s3diff({
    aws: {
    },
    local: config.uploadDir,
    remote: {
      bucket: 'test.another.yes',
      prefix: ''
    }
  }, function (err, data) {
  // data is an object with the following properties:
  //  changed: Files that have been changed - files that exists in both s3 & locally but are out of sync
  //  extra: Files that exists locally but not in s3
  //  missing: Files that exists in s3 but not locally
  //  keep: Files that exists both in s3 & locally and that are equal

    // function logChanged(){}


    // Delete files that exist on s3, but not locally
    data.missing.forEach(function(file){});

    // Upload changed files
    data.changed.forEach(function(file){
      uploadFile(s3, config, file);
    });

    // Upload files that exist locally but not on s3
    data.extra.forEach(function(file){
      uploadFile(s3, config, file);
    });

  });


  // glob(pattern, options, function(err, files){
  //   if(err){return cb(err)}
  //
  //   var uploaded = 0;
  //   var to_upload = files.filter(function(item){
  //     return fs.statSync(item).isFile()}).length;
  //
  //   files.forEach(function(file){
  //
  //     fs.stat(file, function(err, stat){
  //       if(err){return cb(err)}
  //       if(stat.isFile()){
  //
  //         var params = {
  //           Bucket: config.domain,
  //           Key: path.relative(config.uploadDir, file),
  //           Body: fs.createReadStream(file),
  //           ContentType: mime.lookup(file)
  //         }
  //
  //         s3.putObject(params, function(err, data){
  //           if(err){return cb(err);}
  //           else(console.log("Uploaded: " + params["Key"]))
  //           uploaded++;
  //           if(uploaded == to_upload){cb(null, files)}
  //         });
  //       }
  //     });
  //   });
  // });
}


module.exports = {
  s3site:s3site,
  deploy:putWebsiteContent,
  config:getConfig
};
