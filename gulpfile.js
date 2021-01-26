// All the general gulp functions
const { src, dest, series, parallel, watch } = require('gulp');

// For processing markup
const twig = require('gulp-twig');
const hashSrc = require('gulp-hash-src');

// Styles. PureCSS is a framework and I'm just including it via NPM.
// PureCSS has utilities to get the paths to the files I need to include in my build.
// Using cssBase64 to include small images directly in the CSS
const sass = require('gulp-sass');
const purecss = require('purecss');
const cssBase64 = require('gulp-css-base64');

// For cleaning, provides a quick way to recursively delete folders
const rimraf = require("rimraf");

// Live server
const connect = require('gulp-connect');

// Deploying to S3. `S3` is the client. `Transform` is used to give me easy access
// to the files being processed by Gulp. `getType` is to automatically determine mime types
// when uploading.
const { S3 } = require('aws-sdk'); 
const { Transform } = require('readable-stream');
const { getType } = require('mime');

// Creates the AWS/S3 client, allowing the library to grab credentials from
// the AWS profile or environment variables, or whatever.
const client = new S3();

// All the individual tasks

// Clean deletes the `dist/` folder.
function clean(cb) {
    rimraf('dist/', cb);
}

// Markup converts the *.twig files to HTML, while specifically excluding any 
// file that starts with an underscore. Note that later in the `watch` job,
// I don't ignore underscore files in the `src`. I still want to trigger a rebuild 
// when those files change, but I don't necessarily want to create files for each 
// of them.
// This process also finds any links to any static files (such as images, javascript, etc),
// and appends a querystring argument of the hash of that file (hashSrc). This busts caches
// when those files change, but allows me to instruct browsers to cache the files
// indefinitely. On the flip side, I instruct browsers to never cache HTML files.
// See the `deploy` task.
function markup() {
    return src(['src/**/*.twig', '!src/**/_*']) 
        .pipe(twig())
        .pipe(hashSrc({ src_path: 'src/', build_dir: 'dist/' }))
        .pipe(dest('dist'))
        .pipe(connect.reload());
}

// javascript just copies the javascript files.
function javascript() {
    return src('src/js/*.js')
        .pipe(dest('dist/js'))
        .pipe(connect.reload());
}

// styles processes the main.scss file (which would import any other necessary files),
// plus two files from PureCSS using the `getFilePath` utility to pull the node_modules 
// paths to the files included via NPM.
// I process all of these files as sass because I can.
function styles() {
    return src(['src/scss/main.scss', purecss.getFilePath('pure.css'), purecss.getFilePath('grids-responsive.css')])
        .pipe(sass({outputStyle: 'compressed'}))
        .pipe(cssBase64())
        .pipe(dest('dist/css'))
        .pipe(connect.reload());
}

// Another copy task. This could be made into a generic function:
// function copyFiles(source, destination) {  
//    return src(source)
//        .pipe(dest(destination))
//        .pipe(connect.reload()); 
//    }
// But this pattern only happens twice here and I'm not sure it's worth the 
// abstraction.
function images() {
    return src('src/img/**/*')
        .pipe(dest('dist/img'))
        .pipe(connect.reload());
}

// Sets up all the watches. Notice in a couple places the source is different
// here than in the build step. For Twig files, I want to rebuild on any change.
// For the SCSS, I don't think the PureCSS files are going to change while I'm 
// working on the project, so I don't bother to watch those.
// This also launches the server.
// Also note that I explicitly accept a callback argument and call it. This is 
// because in this case, I'm not returning a promise and everything in this method 
// is synchronous. So I need to make this function look async to keep gulp happy.
function server(cb) {
    watch('src/**/*.twig', markup);
    watch('src/js/*.js', javascript);
    watch('src/scss/**/*.scss', styles);
    watch('src/img/**/*', styles);

    connect.server({
        root: 'dist/',
        livereload: true
    });

    cb();
}

// This uploads the files to S3. Specifically, it returns a `Transform`,
// which is a duplex stream. Gulp is built around node streams, `pipe` is 
// actually a feature of Node streams, not something Gulp specific.
// There's a lot to this, but basically to make this work you return a 
// `Transform` where both `readableObjectMode` and `writableObjectMode` are true
// (Gulp streams are made up of objects, not buffers or byte arrays like normal
// streams), and then include a `transform` function that performs the work.
// In the transform method, the first argument (`file`) is each file object 
// (a Vinyl in Gulp), the second (`enc`) is supposed to be encoding for normal
// streams, but is not used in Gulp (AFAIK), and the third is the callback function 
// to call when you're done doing your work.
// To pass files through to the next process, you need to call `this.push(file, enc);`
// for anything that continues down the line.
function uploadToS3(bucket, cacheControl) {
    return new Transform({
        readableObjectMode: true,
        writableObjectMode: true,

        transform(file, enc, callback) {
            // If the file is null, it's a directory, so skip it.
            if (file.isNull())
                return callback(null, file);

            // Otherwise, get just the relative path from the Vinyl.
            const uploadPath = file.path
                .replace(file.base, '')
                .replace(new RegExp('\\\\', 'g'), '/')
                .substr(1);
            
            // Lame, but I need a reference to `this` in my `putObject`
            // callback. I know there are utilities to rebind callbacks,
            // better ways to do this, etc.
            const self = this;
            
            // Call the API to put the object in S3.
            client.putObject({
                Bucket: bucket,
                Key: uploadPath,
                Body: file.contents,
                ACL: 'public-read',
                CacheControl: cacheControl,
                ContentType: getType(file.path)
            }, function (err, data) {
                // If there was an error, pass it back up the async train. Toot! Toot!
                if (err)
                    return callback(err);

                // Probably should output something smarter here, but this is at least
                // an indicator that it's working.
                console.log(data);

                // I don't actually need to modify the file at all, but I do need to
                // pass it to the next process. I do that by pushing it to myself.
                // Transform is also a Readable stream, and pushing things is how to
                // make chunks that can be read for the next consumer.
                self.push(file, enc);
                
                // All that done, execute the callback to indicate our async work
                // is done.
                callback(null, file);
            });
        }
    });
}

// Deploying files is a 2 step process. Non-HTML files get deployed with immutable
// caching, and HTML is deployed with no caching.
function deployNonHtmlFiles() {
    return src(['dist/**/*', '!dist/**/*.html'])
        .pipe(uploadToS3('bobdavidson.dev', 'public, max-age=31536000, immutable'));
}

function deployHtmlFiles() {
    return src('dist/**/*.html')
        .pipe(uploadToS3('bobdavidson.dev', 'public, max-age=0, must-revalidate'));
}

// These tasks are just processes made up of steps.
// `series` are tasks that are done one after another.
// `parallel` are done at the same time.
const deployHtml = parallel(deployNonHtmlFiles, deployHtmlFiles);
// For example, here images, JS, and CSS can all be done at the same time
// as they don't interact. But `markup` must be done AFTER all those other
// steps are completed, since the hashing plugin requires those files to be in 
// place in the destination.
// In theory `parallel` saves time. In reality this project is too small to 
// really benefit from it.
const build = series(parallel(images, javascript, styles), markup);

// Exporting all the public tasks
exports.build  = build;
exports.clean = clean;
exports.server = series(build, server);
exports.deploy = series(clean, build, deployHtml);

