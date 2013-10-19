#!/usr/bin/env node
var fs = require("fs");
var os = require("os");
var path = require("path");
var exec = require("child_process").exec;
var spawn = require('child_process').spawn;
var http_proxy = require("http-proxy");
var chokidar = require("chokidar");
var tmp = require('tmp');

var HTTP_PORT = 80;
var HTTPS_PORT = 443;
// start httpd router
// restart httpd when config changes.

var home = process.env[(process.platform === "win32") ? "USERPROFILE" : "HOME"]
var config_dir = process.env["LOCAL_TLD_CONF"] || path.join(home, '.local-tld');
var config_file = path.join(config_dir, 'config.json');
var hosts_file = os.platform() === "win32" ? "C:\\Windows\\System32\\Drivers\\etc\\hosts" : "/etc/hosts";

var ssl_ca_pem = path.join(config_dir, 'ca.pem');
var ssl_ca_key = path.join(config_dir, 'ca.key');
var ssl_site_pem = path.join(config_dir, 'site.pem');
var ssl_site_key = path.join(config_dir, 'site.key');

var config;
var httpd;
var https;
var routes;
var ssl;

var run = function (command, args, options, callback) {
  if (!callback) {
    callback = options;
    options = {};
  }
  child = spawn(command, args, {stdio: 'inherit'});
  child.on('exit', function (code) {
    callback(null, code);
  });
};

function reloadServers() {
  console.log("Reloading HTTP proxy");
  if (httpd) httpd.close();
  httpd = null;
  var options = {router: routes};
  httpd = http_proxy.createServer(options)
  httpd.on("listening", function() {
    console.log("httpd running");
  });
  httpd.listen(HTTP_PORT);

  console.log("Reloading HTTPS proxy");
  if (https) https.close();
  https = null;
  if (ssl) {
    https = http_proxy.createServer({router: routes, https: ssl});
    https.on("listening", function() {
      console.log("https running");
    });
    https.listen(HTTPS_PORT);
  }
  
  console.log("done");
}
    
function ensureCAExists(cb) {
  if (!fs.existsSync(ssl_ca_pem)) {
    run('openssl', ['genrsa', '-out', ssl_ca_key, 2048], function(err) {
      if (err) return cb(err);
      run('openssl', ['req', '-subj', '/C=US/ST=California/L=San Francisco/CN=local-tld CA', '-x509', '-new', '-nodes', '-key', ssl_ca_key, '-days', '9999', '-out', ssl_ca_pem], cb);
    });
  }
  else {
    cb()
  }
};

function buildExtFile(hosts, cb) {
  tmp.tmpName(function(err, extFile) {
    if (err) return cb(err);
    stream = fs.createWriteStream(extFile);
    stream.write([
      '[req]',
      'req_extensions = v3_req',
      '',
      '[v3_req]',
      'keyUsage = keyEncipherment, dataEncipherment',
      'extendedKeyUsage = serverAuth',
      'subjectAltName = @alt_names',
      '',
      '[alt_names]',
    ].join('\n'), 'utf8');
    for (var i=0, host; host = hosts[i]; i++) {
      stream.write('\nDNS.'+(i+1)+' = '+host, 'utf8');
    }
    stream.end(function(err) {
      cb(err, extFile);
    });
  });
}
    
function buildKeyFile(hosts, cb) {
  buildExtFile(hosts, function(err, extFile) {
    if (err) return cb(err);
    run('openssl', ['genrsa', '-out', ssl_site_key, 2048], function(err) {
      if (err) return cb(err);
      tmp.tmpName(function(err, csrFile) {
        if (err) return cb(err);
        tmp.tmpName(function(err, srlFile) {
          if (err) return cb(err);
          run('openssl', ['req', '-subj', '/C=US/ST=California/L=San Francisco/CN=local-tld', '-new', '-key', ssl_site_key, '-out', csrFile], function(err) {
            if (err) return cb(err);
            run('openssl', ['x509', '-req', '-days', 9999, '-in', csrFile, '-CA', ssl_ca_pem, '-CAkey', ssl_ca_key, '-CAserial', srlFile, '-CAcreateserial', '-out', ssl_site_pem, '-extensions', 'v3_req', '-extfile', extFile], cb);
          });
        });
      });
    });
  });
}
  
var watcher = chokidar.watch(config_file,{persistent:true});
watcher.on("all",function(type,path,stats){
  try {
    config = JSON.parse(fs.readFileSync(config_file));
  } catch (e) {
    console.log("Parsing of config file %s failed:", config_file);
    console.log(e);
    if (!config) config = {};
  }
  if (config.ports) {
    routes = generateRoutes(config.ports);
  }
  console.log(routes);
  if (config.ssl) {
    ensureCAExists(function(err) {
      console.log('ca good!');
      if (err) throw err;
      var hosts = [];
      for (var host in routes) hosts.push(host);
      console.log('hosts', hosts);
      buildKeyFile(hosts, function(err) {
        console.log('keyfile');
        if (err) throw err;
        ssl = {
          key: fs.readFileSync(ssl_site_key),
          cert: fs.readFileSync(ssl_site_pem),
          ca: [fs.readFileSync(ssl_ca_pem)]
        };
        console.log(ssl);
        reloadServers();
      });
    });
  }
  else {
    reloadServers();
  }
});

function generateRoutes(config) {
  var i;
  var routes = {};
  var localIPs = [];
  var interfaces = os.networkInterfaces();
  for (var name in interfaces) {
    var iface = interfaces[name];
    for (i = 0; i < iface.length; i++) {
      ip = iface[i];
      if (ip.family === "IPv4" && ip.internal === false) localIPs.push(ip.address);
    }
  }
  for (var port in config) {
    var options = config[port];
    routes[options.name + ".dev"] = "127.0.0.1:" + port;

    if (options.aliases) {
      var alias;
      for (var alias in options.aliases) {
        routes[alias + "." + options.name + ".dev"] = "127.0.0.1:" + port;

        for (var j = 0, localIP; localIP = localIPs[j]; j++) {
          routes[alias + "." + options.name + "." + localIPs[j] + ".xip.io"] = "127.0.0.1:" + port;
        }
      }
    }

    for (i = 0; i < localIPs.length; i++) {
      routes[options.name + "." + localIPs[i] + ".xip.io"] = "127.0.0.1:" + port;
    }
  }
  return routes;
}

// function hosts(name, onRead, onWrite) {
//   var BEGIN, END, entry, env, exit;

//   entry = -1;
//   exit = -1;
//   BEGIN = "### BEGIN " + name + " ###";
//   END = "### END " + name + " ###";
//   env = {
//     hosts: {},
//     add: function(name, ip) {
//       this.hosts[name] = ip;
//     },
//     remove: function(name) {
//       delete this.hosts[name];
//     }
//   };
//   fs.readFile(hosts_file, { encoding: "ascii" }, function(err, data) {
//     var current, host, i, ip, line, newhosts, str, name;
//     if (err) throw err;
//     data = data.split(os.EOL);
//     for (i = 0; i < data.length; i++) {
//       line = data[i];
//       if (line.indexOf(BEGIN) > -1) {
//         entry = i;
//       }
//       if (line.indexOf(END) > -1) {
//         exit = i;
//       }
//     }
//     if (entry === -1) {
//       entry = data.length;
//       data.push(BEGIN);
//     }
//     if (exit === -1) {
//       data.splice(entry + 1, 0, END);
//       exit = entry + 1;
//     }
//     current = data.slice(entry + 1, exit);
//     for (i = 0; i < current.length; i++) {
//       host = current[i];
//       str = host.split(" ");
//       ip = str[0];
//       name = str[str.length - 1];
//       env.hosts[name] = ip;
//     }
//     if (onRead) {
//       onRead.call(env);
//     }
//     newhosts = [];
//     for (name in env.hosts) {
//       ip = env.hosts[name];
//       newhosts.push("" + ip + " " + name);
//     }
//     data.splice.apply(data, [entry + 1, exit - entry - 1].concat(newhosts));
//     fs.writeFile(hosts_file, data.join(os.EOL), { encoding: "ascii" }, function(err) {
//       if (err) throw err;
//       if (os.platform() === "win32") {
//         exec("ipconfig /flushdns", function(err) {
//           if (err) throw err;
//           if (onWrite) {
//             onWrite();
//           }
//         });
//       } else {
//         if (onWrite) {
//           onWrite();
//         }
//       }
//     });
//   });
// }
