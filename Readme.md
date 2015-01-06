## s3-website

Easily publish static websites to Amazon S3.

Creates a bucket with the specified name and enables static website hosting on it. Also, sets up a public-read bucket policy.

Your AWS credentials should either be in `~/.aws/credentials` or in the environment variables `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

### Installation

`s3-website` is a [node.js](http://nodejs.org) program/module.

```
npm install -g s3-website
```

### Usage (CLI)

```
$ s3-website -h

  Usage: s3-website [options] domain

  Options:

    -h, --help             output usage information
    -V, --version          output the version number
    -r, --region <region>  Region [us-east-1]
    -i, --index <index>    Index Document [index.html]
    -e, --error <error>    Error Document

```

`s3-website -r eu-central-1 cool.website.me` would create a website bucket with the following URL `http://cool.website.me.s3-website.eu-central-1.amazonaws.com`.
You can then set up a CNAME record for `cool.website.me` pointing to that hostname.

### Usage (API)

```javascript
var s3site = require('s3-website')

s3site({
  domain: 'test.site.me', // required, will be the bucket name
  region: 'eu-central-1', // optional, default: us-east-1
  index: 'index.html', // optional index document, default: index.html
  error: '404.html' // optional error document, default: none
}, function(err, website) {
  if (err) throw err
  console.log(website)
})
```

### TODO

- routing setup
- TLS via cloudfront
- www -> non-www redirect (via Route 53 hack)

### License
ISC