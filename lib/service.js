#!/usr/bin/env node
var fs = require("fs");
var os = require("os");
var path = require("path");
var exec = require("child_process").exec;
var http_proxy = require("http-proxy");
var chokidar = require("chokidar");

var HTTP_PORT = 80;
// start httpd router
// restart httpd when config changes.

// var config_file = path.join(process.env[(process.platform === "win32") ? "USERPROFILE" : "HOME"],".local-tld.json");
var config_file = process.env["LOCAL_TLD_CONF"];
var hosts_file = os.platform() === "win32" ? "C:\\Windows\\System32\\Drivers\\etc\\hosts" : "/etc/hosts";


var config;
var httpd;
var dns;
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
  // hosts("local-tld",function(){
  //   this.hosts = {};
  //   for (var host in routes) {
  //     if (host.indexOf(".xip.io",host.length - 7) !== -1) continue;
  //     this.add(host,"127.0.0.1");
  //   }
  // },function(){
  //   console.log("hosts file updated");
  // });
  console.log("Reloading dns");
  if (!dns) {
    dns = dnsServer(config.dns);
    dns.serve(53);
  }
  console.log("Reloading proxy");
  if (httpd) httpd.close();
  httpd = http_proxy.createServer({
    router: routes
  });
  httpd.on("listening", function() {
    console.log("httpd running");
  });
  httpd.listen(HTTP_PORT);
  console.log("done");
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
      for (i = 0; alias = options.aliases[i]; i++) {
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

function dnsServer(nameservers){
  console.log(nameservers);
  var dns = require("native-dns");
  var server = dns.createServer();
  server.on("request", function(req,res){
    var domain = req.question[0].name;
    if (domain.indexOf(".dev",domain.length - 4) !== -1){
      res.answer.push({
        type: 1,
        "class": 1,
        name: domain,
        address: "127.0.0.1",
        ttl: 30
      });
      res.send();
    } else {
      var attempts = 0;
      var ask = dns.Request({
        question: {name: domain, type: 1, "class": 1},
        server: {address: nameservers[attempts], port: 53, type: "udp"},
        timeout: 1000
      });
      ask.on("message", function(err, answer){
        res.answer = answer.answer;
        res.send();
      });
      ask.on("timeout", function(){
        if (nameservers[++attempts]) {
          ask.server.address = nameservers[attempts];
          ask.send();
        }
      });
      ask.send();
    }
  });
  server.on("error", function(err, buf, req, res){
    console.log(err);
  });
  server.on("listening",function(){
    console.log("dns server running");
  });
  return server;
}
