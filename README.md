# BobDavidson.dev

Welcome to the source code of [BobDavidson.dev](https://bobdavidson.dev/). This is meant to be a site where I showcase links to content I've created around the web. It's also a place where I can experiment with different builds and deployments for simple static sites.

I decided to make my source code available (really, the `gulpfile.js` is currently the only interesting part of this) on the off chance that someone will find it useful.

## Technology Stack

The site is currently built and deployed via a Gulp script. The script does several things:

* Compiles SCSS files into CSS.
* Embeds linked images directly into the CSS.
* Copies static files (such as javascript)
* Compiles Twig templates
* Adds a querystring cache-buster to links to static assets
* Uploads to S3 with appropriate cache headers for the HTML and other assets.

If you're interested, the `gulpfile.js` is heavily commented.
