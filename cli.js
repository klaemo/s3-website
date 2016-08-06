#!/usr/bin/env node

var AWS = require('aws-sdk')
var s3Website = require('./')
var program = require('commander')
var url = require('url')

var s3site = s3Website.s3site
var deploy = s3Website.deploy
var getConfig = s3Website.config

program
  .usage(':Use one of commands below to create an s3-website or deploy content to an existing bucket.\n' +
    '\n  Credentials: Aws Credentials should either be supplied in a local .env file or in ~/.aws/credentials\n' +
    '    Credentials should follow this format: \n    AWS_ACCESS_KEY_ID=MY_KEY_ID\n    AWS_SECRET_ACCESS_KEY=MY_SECRET_KEY\n\n' +
    'To see more information about any command: \n    s3-website command -h'
  )
  .version(require('./package.json').version)

program
  .command('create <domain>')
  .usage('<domain> [options]')
  .description('Will create and configure an s3 website')
  .option('-r, --region <region>', 'Region [us-east-1].')
  .option('-i, --index <index>', 'Index Document [index.html].')
  .option('-e, --error <error>', 'Error Document.')
  .option('-t, --routes <routes>', 'Path to routing rules file.')
  .option('--json', 'Output JSON.')
  .option('--cert-id <IAM ServerCertId>', 'The ID of your cert in IAM.')
  .option('-c, --cert <cert>', 'Path to the public key certificate.')
  .option('-k, --key <key>', 'Path to the private key.')
  .option('-n, --cert-name <certificate name>', 'A unique name for the server certificate.')
  .option('-u, --upload-dir <upload directory>', 'Upload contents of directory to s3 site.')
  .option('--intermediate <intermediate certs>', 'Path to the concatenated intermediate certificates.')
  .action(function (domain, options) {
    options.domain = domain
    s3site(options, function (err, website) {
      if (err) {
        if (options.json) {
          console.error(JSON.stringify({ code: err.code, message: err.message }))
        } else {
          console.error('Error:', err.message)
        }
        process.exit(1)
      }
      if (options.json) {
        console.log(JSON.stringify(website))
      } else {
        console.log('Successfully created your website.\n')
        console.log('URL:\n  ' + website.url + '\n')
        console.log('DNS:\n  ' + options.domain + '. CNAME ' + url.parse(website.url).host + '.\n')
        if (website.certId) {
          console.log('Certificate ID:\n  ' + website.certId + '\n')
        }
      }
    })
  })

program
  .command('deploy <upload-dir>')
  .usage('<dir> [options]')
  .description('Will push contents of directory to specified s3 website')
  .option('-r, --region <region>', 'Region [us-east-1].')
  .option('-d, --domain <domain>', 'Name of bucket [example.bucket]')
  .action(function (uploadDir, options) {
    getConfig('.s3-website.json', function (err, config) { // eslint-disable-line handle-callback-err
      if (!config) config = {}
      if (options.region) config.region = options.region
      if (options.domain) config.domain = options.domain
      if (uploadDir) config.uploadDir = uploadDir

      var s3 = new AWS.S3({ region: config.region })
      deploy(s3, config, function (err, files) {
        if (err) {
          console.error('\n' + err.message + '\n')
          process.exit(1)
        }
      })
    })
  })
  .on('--help', function () {
    console.log(' ')
    console.log('Deploy requires 3 things: ')
    console.log('region: the region where your bucket lives, can be set by commandline flag or in config file')
    console.log('domain: the name of your bucket, can be set by commandline flag or in config file')
    console.log('uploadDir: the name of the directory whose contents you want to upload,' +
      'can be supplied as first argument to deploy or in config file')
    console.log(' ')
    console.log('These can be supplied as command line arguments, or in a json config file')
    console.log(' ')
    console.log('Config file: ')
    console.log('Should be titled .s3-website.json')
    console.log('should contain only a JSON object with keys: region, domain, uploadDir')
  })

program
  .command('*')
  .description('Output usage message')
  .action(function (env) {
    program.help()
  })

program.parse(process.argv)
if (!program.args.length) program.outputHelp()
