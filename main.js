#!/usr/bin/env node
/**
 * Forked from https://github.com/bahamas10/node-git-http-server,
 * Author: Dave Eddy <dave@daveeddy.com>
 * License: MIT
 */

var accesslog = require('access-log');
var backend = require('git-http-backend');
var getopt = require('posix-getopt');
var http = require('http');
var package = require('./package.json');
var path = require('path');
var spawn = require('child_process').spawn;
var url = require('url');


var server = module.exports = {

  // default opts:
  opts: {
    dir: process.cwd(),
    ip: process.env.GIT_HTTP_IP || null,
    host: process.env.GIT_HTTP_HOST || '0.0.0.0',
    port: process.env.GIT_HTTP_PORT || 8174,
    readonly: process.env.GIT_HTTP_READONLY,
  },

  run: function(_opts) {
    var s = server,
        opts = s.opts;

    if (_opts && typeof _opts === 'object') {
      Object.keys(_opts).forEach(function(k) {
        opts[k] = _opts[k];
      });
    }

    var dir = s.dir;
    if (dir) process.chdir(dir);

    http.createServer(onrequest).listen(opts.port, opts.host, started);

    function started() {
      console.log('listening on http://%s:%d in %s', 
        opts.host, opts.port, process.cwd());
    }

    function onrequest(req, res) {
      accesslog(req, res);
      var ip = req.ip || 
        req.connection.remoteAddress || 
        req.socket.remoteAddress || 
        req.connection.socket.remoteAddress;
      if (ip != '127.0.0.1' && !(opts.ip && opts.ip == ip)) {
        res.statusCode = 403; // forbidden
        res.end();
        return;
      }

      // ensure the user isn't trying to send up a bad request
      var u = url.parse(req.url);
      if (u.pathname !== path.normalize(u.pathname)) {
        res.statusCode = 400;
        res.end();
        return;
      }

      var repo = u.pathname.split('/')[1];

      req.pipe(backend(req.url, function(err, service) {
        if (err) {
          res.statusCode = 500;
          res.end(err + '\n');
          return;
        }

        res.setHeader('content-type', service.type);

        if (opts.readonly && service.cmd !== 'git-upload-pack') {
          res.statusCode = 403;
          res.end('server running in read-only mode\n');
          return;
        }

        var ps = spawn(service.cmd, service.args.concat(repo));
        ps.stdout.pipe(service.createStream()).pipe(ps.stdin);
      })).pipe(res);
    }
  },
};

// Command-line interface
if (!module.parent) (function() {
  var usage = [
    'usage: git-http-server [-r] [-p port] [-H host] [dir]',
    '',
    'options',
    '',
    '  -h, --help          print this message and exit',
    '  -i, --ip            [env GIT_HTTP_IP] IP address of the allowed client',
    '  -H, --host <host>   [env GIT_HTTP_HOST] host on which to listen',
    '  -p, --port <port>   [env GIT_HTTP_PORT] port on which to listen',
    '  -r, --readonly      [env GIT_HTTP_READONLY] operate in read-only mode',
    '  -u, --updates       check for available updates and exit',
    '  -v, --version       print the version number and exit',
  ].join('\n');

  var options = [
    'h(help)',
    'i:(ip)',
    'H:(host)',
    'p:(port)',
    'r(readonly)',
    'u(updates)',
    'v(version)'
  ].join('');
  var parser = new getopt.BasicParser(options, process.argv);

  var cmdOpts = {};
  var option;
  while ((option = parser.getopt())) {
    switch (option.option) {
      case 'h': console.log(usage); process.exit(0); break;
      case 'i': cmdOpts.ip = option.optarg; break;
      case 'H': cmdOpts.host = option.optarg; break;
      case 'p': cmdOpts.port = option.optarg; break;
      case 'r': cmdOpts.readonly = true; break;
      case 'u': // check for updates
        require('latest').checkupdate(package, function(ret, msg) {
          console.log(msg);
          process.exit(ret);
        });
        return;
      case 'v': console.log(package.version); process.exit(0); break;
      default: console.error(usage); process.exit(1); break;
    }
  }
  var args = process.argv.slice(parser.optind());
  var dir = args[0];

  server.run(cmdOpts);
})();