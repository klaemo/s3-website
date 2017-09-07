#!/usr/bin/env node

var AWS = require('aws-sdk')
var s3Website = require('./')
var program = require('commander')
var url = require('url')
var s3site = s3Website.s3site
var deploy = s3Website.deploy
var getConfig = s3Website.config
var templateConfig = s3Website.templateConfig
require('console.table')
require('colors')

/**
* Filter out commander specific properties from options hash, and merge command
* line parameters into single hash.
*/
function getCLArguments (params, options) {
  var fromCL = {}
  var fromCLKeys = Object.keys(options).filter(function (item) {
    var toRemove = ['commands', 'parent', 'options']
    if (item.startsWith('_')) return false
    return toRemove.indexOf(item) < 0
  })
  var paramKeys = Object.keys(params)
  fromCLKeys.forEach(function (key) { if (options[key]) fromCL[key] = options[key] })
  paramKeys.forEach(function (key) { if (params[key]) fromCL[key] = params[key] })
  return fromCL
}

function printDeployResults (err, website, results) {
  if (err) {
    console.error(err.message)
    process.exit(1)
  }

  var numRows = Object.keys(results).reduce(function (prev, current) {
    if (results[current].length > prev) { prev = results[current].length }
    return prev
  }, 0)

  var values = new Array(numRows)
  values.fill(0)
  values = values.map(function (_, index) {
    var row = {}
    Object.keys(results).forEach(function (key) {
      if (results[key][index]) {
        row[key] = results[key][index]
      } else {
        row[key] = ' '
      }
    })
    return row
  })

  if (values.length > 0) {
    console.table('\n\nDeployment Report'.yellow, values)
  }

  var isEmpty = Object.keys(results).reduce(function (prev, current) {
    if (results[current].length > 0) { return false }
    return prev
  }, true)

  if (isEmpty) {
    console.log('There were no changes to deploy'.yellow)
  } else {
    if (website.url) console.log(('Updated site: ' + website.url).green)
  }
}

function exclude (val, excludedList) {
  excludedList.push(val)
  return excludedList
}

program
  .usage('<command> [option]')
  .description(
    'Use one of commands below to create an s3-website or deploy content to an existing bucket.'
  ).on('--help', function () {
    console.log('  Credentials:')
    console.log('')
    console.log('    Aws Credentials should either be supplied in a local .env file or in ~/.aws/credentials')
    console.log('      Credentials should follow this format:')
    console.log('        AWS_ACCESS_KEY_ID=MY_KEY_ID')
    console.log('        AWS_SECRET_ACCESS_KEY=MY_SECRET_KEY')
    console.log(' ')
    console.log('  Config file: ')
    console.log('')
    console.log('    Should be specified using the -f flag. The default config file is .s3-website.json')
    console.log('    Should contain only a JSON object containing at least the keys: region, domain, uploadDir')
    console.log('')
    console.log('  To see more information about a specific command:')
    console.log('    s3-website <command> -h'.green)
  })
  .version(require('./package.json').version)

program
  .command('create [domain]')
  .usage('[domain [options]]')
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
  .option('-u, --upload-dir <upload directory>', 'Set directory to upload when site is deployed.')
  .option('-d, --deploy', 'Will upload uploadDir immediately after site creation')
  .option('-p, --prefix <prefix>', 'Will upload files with the prefix [name/of/folder/to/sync/on/s3]')
  .option('-l, --lock-config', 'Will prevent config file from being changed')
  .option('--intermediate <intermediate certs>', 'Path to the concatenated intermediate certificates.')
  .option('-f, --config-file <file>', 'Path to the config file to read. Default is .s3-website.json')
  .option('--exclude <path-pattern>', 'Path pattern to excluded files from being created/updated/removed. This option is repeatable', exclude, [])
  .action(function (domain, options) {
    var fromCL = getCLArguments({domain: domain}, options)
    if (fromCL.configFile == null) fromCL.configFile = '.s3-website.json'

    getConfig(fromCL.configFile, fromCL, function (err, config) { // eslint-disable-line handle-callback-err
      s3site(config, function (err, website, uploadResults) {
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
          console.log('Successfully created your website.\n'.green)
          console.log('  URL:')
          console.log('    ' + website.url)
          console.log('  DNS:')
          console.log('    ' + config.domain + '. CNAME ' + url.parse(website.url).host + '.\n')
          if (website.certId) {
            console.log('  Certificate ID:\n  ' + website.certId + '\n')
          }
          printDeployResults(null, website, uploadResults)
        }
      })
    })
  })

program
  .command('deploy [upload-dir]')
  .usage('[dir] [options]')
  .description('Will push contents of directory to specified s3 website')
  .option('-r, --region <region>', 'Region [us-east-1].')
  .option('-p, --prefix <prefix>', 'Will upload files with the prefix [name/of/folder/to/sync/on/s3]')
  .option('-l, --lock-config', 'Will prevent config file from being changed')
  .option('-d, --domain <domain>', 'Name of bucket [example.bucket] - put always this parameter last one')
  .option(
    '-f, --config-file <file>',
    'Path to the config file to read. Default is .s3-website.json. Note: Using non-standard config file will require passing "-f myConfigFile" with subsequent operations'
  )
  .option('--exclude <path-pattern>', 'Path pattern to excluded files from being created/updated/removed. This option is repeatable', exclude, [])
  .action(function (uploadDir, options) {
    var fromCL = getCLArguments({uploadDir: uploadDir}, options)
    if (fromCL.configFile == null) fromCL.configFile = '.s3-website.json'
    getConfig(fromCL.configFile, fromCL, function (err, config) { // eslint-disable-line handle-callback-err
      var s3 = new AWS.S3({ region: config.region })
      deploy(s3, config, printDeployResults)
    })
  }).on('--help', function () {
    console.log(' ')
    console.log('  Successful deployment requires: '.yellow)
    console.log('')
    console.log('    Correct config: - passed from commandline or from config file specified with -f flag')
    console.log('      region: the region where your bucket lives, can be set by commandline flag or in config file')
    console.log('      domain: the name of your bucket, can be set by commandline flag or in config file')
    console.log('      uploadDir: the name of the directory whose contents you want to upload,' +
      'can be supplied as first argument to deploy or in config file')
    console.log('')
    console.log('    Valid AWS credentials: - run s3-website -h for more info')
    console.log(' ')
    console.log('  These can be supplied as command line arguments, or in a json config file specified with -f flag'.green)
  })

program
  .command('configTemplate')
  .usage('')
  .description('Creates a configuration file template, which can be used to create site by setting config details and running s3-website create')
  .action(function () {
    getConfig('.s3-website.json', templateConfig, function (err, config) { // eslint-disable-line handle-callback-er
      if (err) { console.err(err) }
    })
  })

program
  .command('*')
  .description('Output usage message')
  .action(function (env) {
    program.help()
  })

program.parse(process.argv)
if (!program.args.length) program.outputHelp()
