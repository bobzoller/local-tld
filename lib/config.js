var path = require("path");
var fs = require("fs");
var config_dir = path.join(process.env[(process.platform === "win32") ? "USERPROFILE" : "HOME"],".local-tld");
var config_file = path.join(config_dir, 'config.json');
var base_port = 6000;
var default_config = {"ports": {}};
if (!fs.existsSync(config_dir)) fs.mkdirSync(config_dir);
fs.openSync(config_file, 'a');

function read(){
  try {
    var config = JSON.parse(fs.readFileSync(config_file));
    if (config && !config["ports"]) {
      console.log("upgrading config");
      var ports = config;
      config = default_config; // probably correct to clone
      config.ports = ports;
    }
    return config;
  } catch (e) {
    return default_config;
  }
}
function write(data){
  fs.writeFileSync(config_file,JSON.stringify(data,null,"\t"));
}

function add(port,domain,aliases) {
  var config = read();
  config["ports"][port] = {
    name: domain
  };
  if (aliases && aliases.length) {
    for (var i=0; i < aliases.length; i++) {
      config["ports"][port].aliases[aliases[i]] = true;
    }
  }
  write(config);
}
function setAlias(name, alias) {
  var config = read();
  for (var port in config["ports"]) {
    if (config["ports"][port].name === name) {
      if (!config["ports"][port].aliases) config["ports"][port].aliases = {};
      config["ports"][port].aliases[alias] = true;
      write(config);
      return true;
    }
  }
  return false;
}
function removeAlias(name, alias) {
  var config = read();
  for (var port in config["ports"]) {
    if (config["ports"][port].name === name && config["ports"][port].aliases && config["ports"][port].aliases[alias]){
      delete config["ports"][port].aliases[alias];
      return true;
    }
  }
  return false;
}

function getPort(name) {
  var config = read();
  var max = base_port;
  for (var port in config["ports"]) {
    if (config["ports"][port].name === name) return port;
    portInt = parseInt(port, 10);
    if (portInt > max) max = portInt;
  }
  config["ports"][++max] = {
    name: name
  };
  write(config);
  return max;
}

function remove(port) {
  var config = read();
  delete config["ports"][port];
  write(config);
}

module.exports = {
  dir: config_dir,
  read: read,
  write: write,
  add: add,
  remove: remove,
  getPort: getPort,
  setAlias: setAlias,
  removeAlias: removeAlias
};
