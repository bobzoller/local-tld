var os = require("os");
var path = require("path");
var fs = require("fs");
var exec = require("child_process").exec;
var service = {};

var config_file = require("./config").file;
var service_file = path.join(path.dirname(module.filename),"service.js");

switch (os.platform()) {
  case "win32":
    var win = require("node-windows");
    var svc = new win.Service({
      name: "Local-tld",
      description: "Routes local.dev domains",
      script: service_file,
      env: {
        name: "LOCAL_TLD_CONF",
        value: config_file
      }
    });
    service = {
      install: function(done){
        svc.on("install",function(){
          if (done) done();
        });
        svc.install();
      },
      remove: function(done){
        svc.on("uninstall",function(){
          if (done) done();
        });
        svc.uninstall();
      },
      start: function(done){
        svc.on("start",function(){
          if (done) done();
        });
        svc.start();
      },
      stop: function(done){
        svc.on("stop",function(){
          if (done) done();
        });
        svc.stop();
      },
      exists: function(done){
        done(svc.exists());
      }
    };
    break;
  case "darwin":
    var launchDTpl = path.join(path.dirname(module.filename),"../etc/darwin/ie.hood.local-tld-service.plist.tpl");
    var launchD = "/Library/LaunchDaemons/ie.hood.local-tld-service.plist";
    var resolverTpl = path.join(path.dirname(module.filename),"../etc/darwin/resolver.tpl");
    var resolver = "/etc/resolver/dev"
    service = {
      install: function(done){
        fs.readFile(launchDTpl,{ encoding:"utf8" }, function(err,data){
          if (err) throw err;
          data = data.replace("{{ NODE_BIN }}",process.execPath).replace("{{ SERVICE_FILE }}",service_file).replace("{{ CONFIG_FILE }}",config_file);
          fs.writeFile(launchD,data,{ encoding:"utf8" }, function(err){
            if (err) throw err;
            exec("mkdir -p "+path.dirname(resolver), function(err) {
              if (err) throw err;
              fs.readFile(resolverTpl, { encoding:"utf8" }, function(err,data){
                if (err) throw err;
                fs.writeFile(resolver, data, {encoding: "utf8"}, function(err) {
                  if (err) throw err;
                  if (done) done();
                });
              });
            });
          });
        });
      },
      remove: function(done){
        fs.unlink(launchD,function(err){
          if (err) throw err;
          fs.unlink(resolver, function(err) {
            if (err) throw err;
            if (done) done();
          });
        });
      },
      start: function(done){
        exec("launchctl load -wF " + launchD, function(err){
          if (err) throw err;
          if (done) done();
        });
      },
      stop: function(done){
        exec("launchctl unload " + launchD, function(err){
          if (err) throw err;
          if (done) done();
        });
      },
      exists: function(done){
        done(fs.existsSync(launchD));
      }
    };
    break;
  case "linux":
    var upstartTpl = path.join(path.dirname(module.filename),"../etc/linux/local-tld.conf.upstart.tpl");
    var upstart = "/etc/init/local-tld.conf";
    service = {
      install: function(done){
        fs.readFile(upstartTpl,{ encoding:"utf8" },function(err,data){
          if (err) throw err;
          data = data.replace("{{ NODE_BIN }}",process.execPath).replace("{{ SERVICE_FILE }}",service_file).replace("{{ CONFIG_FILE }}",config_file);
          fs.writeFile(upstart,data,{ encoding:"utf8" },function(err){
            if (err) throw err;
            if (done) done();
          });
        });
      },
      remove: function(done){
        fs.unlink(upstart,function(err){
          if (err) throw err;
          if (done) done();
        });
      },
      start: function(done){
        exec("initctl start local-tld", function(err){
          if (err) throw err;
          if (done) done();
        });
      },
      stop: function(done){
        exec("initctl stop local-tld", function(err){
          if (err) throw err;
          if (done) done();
        });
      },
      exists: function(done){
        done(fs.existsSync(upstart));
      }
    };
    break;
}
service.file = service_file;
module.exports = service;
