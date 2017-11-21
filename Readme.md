## s3-website

Easily publish static websites to Amazon S3. TLS encryption can be enabled via Cloudfront.

Creates a bucket with the specified name and enables static website hosting on it. Also, sets up a public-read bucket policy.

Your AWS credentials should either be in `~/.aws/credentials`, a file in the local directory entitled .env with the values
```
AWS_ACCESS_KEY_ID=MY_KEY_ID
AWS_SECRET_ACCESS_KEY=MY_SECRET_KEY
```
 or in the environment variables `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

Your website policy and configuration will only be sent to S3 when it differs
from the existing.

### Note!

Because of limitations of the S3 API, any changes made to the website policy or
configuration in the S3 web interface, or elsewhere, will be overwritten by the
settings provided to `s3-website`.

### Installation

`s3-website` is a [node.js](http://nodejs.org) program/module.

```
npm install -g s3-website
```


### Usage (CLI)

```

  $ s3-website -h
  Commands:

    create [options] <domain>      Will create and configure an s3 website
    deploy [options] <upload-dir>  Will push contents of directory to specified s3 website
```
To see options for each command  `s3-website command -h`

#### Create
  Usage `s3-website create <desired.bucket.name> [options]`
  * Will create a new bucket with desired name
  * Will configure bucket for static hosting

#### Deploy
  Usage `s3-website deploy <directory-to-upload> [options]`
  * Will upload all contents of directory to bucket, replacing existing files
  * Bucket can be specified by providing command line argument -d, or --domain
    followed by the name of the s3 bucket. If no option is provided s3-website
    will look for config file written when bucket is created.
  ** Because there is an issue in the command line library, you must to put the "-d" option last.
    The next dependency version should fix this issue


All the options are optional ;-).

`s3-website -r eu-central-1 cool.website.me` creates a website bucket with the following URL `http://cool.website.me.s3-website.eu-central-1.amazonaws.com`.
You can then set up a CNAME record for `cool.website.me` pointing to that hostname.

For the TLS related options take a look at the [cloudfront-tls](https://github.com/klaemo/cloudfront-tls) readme.

### Usage (API)

```javascript
const create = require('s3-website').s3site;

create({
  domain: 'test.site.me', // required, will be the bucket name
  region: 'eu-central-1', // optional, default: us-east-1
  index: 'index.html', // optional index document, default: index.html
  error: '404.html', // optional error document, default: none
  exclude: ['.git/*', '.gitignore'], // optional path patterns to be excluded from being created/updated/removed, default: [], `*` is the wildcard
  routes: [{
    Condition: {
        KeyPrefixEquals: 'foo/'
    },
    Redirect: {
        HostName: 'foo.com'
    }
  }]
}, (err, website) => {
  if(err) {
    throw err;
  }
  console.log(website);
})
```

You can also pass in the same the TLS related options as in [cloudfront-tls](https://github.com/klaemo/cloudfront-tls). So you might want to take a look at its readme if you want to use your own certificates.

If you want to deploy using the API, create an `s3` instance:

```javascript
const deploy = require('s3-website').deploy
    , config = require('./config')
    , AWS = require('aws-sdk')
    , s3 = new AWS.S3({ region: config.region });

deploy(s3, config, (err, website) => {
  if(err) {
    throw err;
  }
  console.log(website);
})
```

### Routing Rules

`RoutingRules` can be provided via cli and API. From the cli you will need to provide the path to
a file that can be loaded via `require`, that is to say, a `.js` or `.json` file. This file
should export an array of rules that conform to the [S3 Routing Rules syntax](http://docs.aws.amazon.com/AmazonS3/latest/dev/HowDoIWebsiteConfiguration.html#configure-bucket-as-website-routing-rule-syntax). Likewise, you can provide an
array of rules to the API with the `routes` option.

### Redirecting All Requests
To redirect all requests to another domain eg: www -> non www
You can use the rederectall option. NOTE: index, error, and routing rules are not needed when redirecting all requests to another domain.
```javascript
const create = require('s3-website').s3site;

create({
  domain: 'www.site.me', // required, will be the bucket name
  region: 'eu-central-1', // optional, default: us-east-1
  redirectall: 'site.me'
}, (err, website) => {
  if(err) {
    throw err;
  }
  console.log(website);
})
```

### Custom Content Types

Sometimes you may want to change the Content Type header for specific files, for example, serve from S3
`php` files as HTML. You can now pass an object (`contentTypes`) describing your custom needs:

```
config.contentTypes = {
  php: 'text/html'
}

deploy(s3, config, (err, website) => {
  if(err) {
    throw err;
  }
  console.log(website);
})
```


### Contributors

- [mshick](https://github.com/mshick)
- [rgruesbeck](https://github.com/rgruesbeck)
- [nick-benoit14](https://github.com/nick-benoit14)
- [simoncurd](https://github.com/simoncurd)
- [StaymanHou](https://github.com/StaymanHou)
- [ChainsawHunter](https://github.com/ChainsawHunter)
- [vladejs](https://github.com/vladejs)
- [rlyle](https://github.com/rlyle)
### License
ISC
