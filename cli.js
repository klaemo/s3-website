#!/usr/bin/env node

var AWS = require('aws-sdk')
var s3Website = require('./')
var program = require('commander')
var url = require('url')

var s3site = s3Website.s3site;
var deploy = s3Website.deploy;

program
  .version(require('./package.json').version)
  .usage('[options] domain')

program
  .command('*')
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
  .action(function(args, options){
    if (!program.args.length) {
      if (program.json) {
        console.error(JSON.stringify({ code: 'DomainUndefined', message: 'no domain specified' }))
      } else {
        console.error('Error: no domain specified')
      }
      process.exit(1)
    }

    program.domain = program.args[0]

    s3site(program, function(err, website) {
      if (err) {
        if (program.json) {
          console.error(JSON.stringify({ code: err.code, message: err.message }))
        } else {
          console.error('Error:', err.message)
        }
        process.exit(1)
      }

      if (program.json) {
        console.log(JSON.stringify(website))
      } else {
        console.log('Successfully created your website.\n')
        console.log('URL:\n  ' + website.url + '\n')
        console.log('DNS:\n  ' + program.domain + '. CNAME ' + url.parse(website.url).host + '.\n')
        if (website.certId) {
          console.log('Certificate ID:\n  ' + website.certId + '\n')
        }
      }
    })
    console.log(program.args)
  })

program
  .command('deploy <upload-dir>')
  .action(function(dir, options){
    var config = {
      region: 'us-east-1',
      domain: 'test.upload.page',
      uploadDir: 'build'
    }
    var s3 = new AWS.S3({ region: config.region })
    deploy(s3, config, function(err, files){
      if(err) console.log(err);
    })
  });


program.parse(process.argv)
