#!/usr/bin/env node

var s3site = require('./')
var program = require('commander')
var url = require('url')

program
  .version(require('./package.json').version)
  .usage('[options] domain')
  .option('-r, --region <region>', 'Region [us-east-1]')
  .option('-i, --index <index>', 'Index Document [index.html]')
  .option('-e, --error <error>', 'Error Document')
  .option('--json', 'Output JSON')
  .parse(process.argv)

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
  }
})
