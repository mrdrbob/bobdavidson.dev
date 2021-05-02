const { Readable } = require('readable-stream');
const Vinyl = require('vinyl');
const { create } = require('xmlbuilder2');

// Very basic RSS generation
exports.generateRss = function (data) {
    // First, using xmlbuilder2 to create well-formed XML feed.
    const channel = create({ version: '1.0' })
        .ele('rss', { 'version': '2.0' })
            .ele('channel');
    
    channel.ele('title').txt(data.title).up();
    channel.ele('link').txt(data.link).up();
    channel.ele('description').txt(data.description).up();

    for (const update of data.updates) {
        channel.ele('item')
            .ele('title').txt(update.title).up()
            .ele('link').txt(update.link).up()
            .ele('description').txt(update.description).up()
        .up();
    }

    // Render this to a string.
    const renderedXml = channel.end();

    // Gulp uses a virtual file system called Vinyl.
    // To pass this to the `dest` function, we create 
    // a file and a stream to read the file from.
    var vinyl = new Vinyl({
        cwd: '/',
        base: '/src/',
        path: '/src/rss.xml',
        contents: Buffer.from(renderedXml, 'utf-8')
    });
    // Gulp uses objectMode, so we set that in our Readable
    // stream.
    var stream = new Readable({
        objectMode: true,
    });
    // We have to provide a `_read` implementation, which just
    // pushes through our virtual file, then a null to signal
    // that's the only file.
    stream._read = function() {
        this.push(vinyl);
        this.push(null);
    };
    return stream;
}
