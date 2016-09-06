/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

var knxObj = require('./lib/generateGAS');


var eibd = require('eibd');

var parseESFString = parseESFString;
var parseString = require('xml2js').parseString;

var esfBuf = require('text-encoding');

var eibdConnection;
var utils =    require(__dirname + '/lib/utils'); // Get common adapter utils

var mapping = {};
var valtype ='';

var knxprojfilename = 'KNX concept - Büro Plön.knxproj';
console.info('knx.js:  ' + '/lib/generateGAS.js' + '         ' + knxprojfilename);

var knxobj = new knxObj();
var gasobj = knxobj.getGAS(knxprojfilename);

var gaRjson = {
        'ga' : [],
        'state' : true,
    };


var adapter = utils.adapter({
    // name has to be set and has to be equal to adapters folder name and main file name excluding extension
    name:           'knx',

    // is called if a subscribed object changes
    objectChange: function (id, obj) {
        adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
    },

    // is called if a subscribed state changes
    stateChange: function (id, state) {
        adapter.log.info('stateChange ' + id  + '  .....  state : ' + JSON.stringify(state));
        // parse Groupaddress from id-string
        var ga = id.substring(id.lastIndexOf('.') + 1);
        ga = ga.replace(/_/g, '/');
        var val;
        adapter.log.info('state ack : ' + state.ack + ' ga :' + ga);
        if (state.ack) {
            adapter.log.info(' setze val von ' + ga + ' auf ' + state.val);
            val = state.val;
        }

        // you can use the ack flag to detect if state is desired or acknowledged
        if (!state.ack)
        {
            adapter.log.info('setting state '+ga+' to '+state.val);
            adapter.log.info('str2addr(' + ga + ') : '+ eibd.str2addr(ga));

            var gad=eibd.str2addr(ga);
            adapter.log.info('Gad : ' + gad);
            //       / * Todo: Guess DPT */

            var tempCon=eibd.Connection();
            tempCon.socketRemote({ host: adapter.config.gwip, port: adapter.config.gwipport },function(x){
                tempCon.openTGroup(gad,0,function(err){
                    // var data = new Array(2);
                    var data;
                    var dataValid = false;
                    adapter.log.info('valType : ' + valtype);
                    switch (valtype) {
                        case (valtype == 'DPT1') :
                            adapter.log.info(valtype + ' encoded ' + data.decodeDPT1);
                            dataValid = true;
                            data = new Array(2);
                            data = data.decodeDPT1;
                            break;
                        case (valtype == 'DPT2') :
                            adapter.log.info(valtype + ' encoded ' + data.encodeDPT2);
                            dataValid = true;
                            data = data.encodeDPT2;
                            break;
                        case (valtype == 'DPT3') :
                            adapter.log.info(valtype + ' encoded ' + data.encodeDPT3);
                            dataValid = true;
                            data = data.encodeDPT3;
                            break;
                        case (valtype == 'DPT4') :
                            adapter.log.info(valtype + ' encoded ' + data.encodeDPT4);
                            dataValid = true;
                            data = data.encodeDPT4;
                            break;
                        case (valtype == 'DPT5') :
                            adapter.log.info(valtype + ' encoded ' + data.encodeDPT5);
                            dataValid = true;
                            data = data.encodeDPT5;
                            break;
                        case (valtype == 'DPT6') :
                            adapter.log.info(valtype + ' encoded ' + data.encodeDPT6);
                            dataValid = true;
                            data = data.encodeDPT6;
                            break;
                        case (valtype == 'DPT7') :
                            adapter.log.info(valtype + ' encoded ' + data.encodeDPT7);
                            dataValid = true;
                            data = data.encodeDPT7;
                            break;
                        case (valtype == 'DPT8') :
                            adapter.log.info(valtype + ' encoded ' + data.encodeDPT8);
                            dataValid = true;
                            data = data.encodeDPT8;
                            break;
                        case (valtype == 'DPT9') :
                            adapter.log.info(valtype + ' encoded ' + data.encodeDPT9);
                            dataValid = true;
                            data = data.encodeDPT9;
                            break;
                        case (valtype == 'DPT10') :
                            adapter.log.info(valtype + ' encoded ' + data.encodeDPT10);
                            dataValid = true;
                            data = data.encodeDPT10;
                            break;
                        case (valtype == 'DPT11') :
                            adapter.log.info(valtype + ' encoded ' + data.encodeDPT11);
                            dataValid = true;
                            data = data.encodeDPT11;
                            break;
                        case (valtype == 'DPT12') :
                            adapter.log.info(valtype + ' encoded ' + data.encodeDPT12);
                            dataValid = true;
                            data = data.encodeDPT12;
                            break;
                        default :
                            dataValid = false;

                    }

                    if (dataValid) {
                        tempCon.sendAPDU(data, function () {
                            tempCon.end();
                        });
                    }
                });
            });
        }

    },

    // is called when adapter shuts down - callback has to be called under any circumstances!
    unload: function (callback) {
        try {
            if (eibdConnection) {
                /* Workaround against Parser not implementing end() - https://github.com/andreek/node-eibd/issues/7 */
                if (eibdConnection.parser) eibdConnection.parser.end = function(){ /* Dummy */ };
                eibdConnection.end();
            }
            // adapter.log.info('cleaned everything up...');
        } finally {
            callback();
        }
    },

    // is called when databases are connected and adapter received configuration.
    // start here!
    ready: function () {
        adapter.subscribeStates('*');
        main();
    }

});

function parseESF(text, callback) {
    parseESFString(text, function (err, result) {
        //Extract the value from the data element
        adapter.log.info('function parseESF');

        callback(err, result);
    });
}


function parseXml(text, callback) {
    //adapter.log.info(' text : ' + text);
    parseString(text, function (err, result) {
        //Extract the value from the data element
        adapter.log.info('function parseXML' + JSON.stringify(text));
        callback(err, result ? result['GroupAddress-Export'] : null);
    });
}

function main() {
    // The adapters config (in the instance object everything under the attribute "native") is accessible via
    // adapter.config:
    adapter.log.info('Connecting to eibd ' + adapter.config.gwip + ":" +adapter.config.gwipport);


    var gaTable = adapter.config.gaTable;

    adapter.log.info(utils.controllerDir);

    function parseGARange(gaRange, path) {
        if (!gaRange) return adapter.log.error('Unknown XML format. No GroupRange found');
        path = path || '';
        // Main groups
        for (var ix = 0; ix < gaRange.length; ix++) {
            var gar = gaRange[ix];
            if (gar.GroupRange) {
                var locpath = path;
                if (gar.$ && gar.$.Name) {
                    locpath += (path ? '.' : '') + gaRange[ix].$.Name.replace(/\./g, '_').replace(/\s/g, '_');
                }
                parseGARange(gaRange[ix].GroupRange, locpath);
            } else if (gar.GroupAddress) {
                var locpath = path;
                if (gar.$ && gar.$.Name) {
                    locpath += (path ? '.' : '') + gar.$.Name.replace(/\./g, '_').replace(/\s/g, '_');
                }
                for (var gaIX = 0; gaIX < gar.GroupAddress.length; gaIX++) {
                    var ga = gar.GroupAddress[gaIX].$;
                    var obj = {
                        _id: (locpath ? locpath + '.' : '') + ga.Address.replace(/\//g, '_'),
                        type: 'state',
                        common: {name: ga.Name},
                        native: {address: ga.Address}
                    };
                    adapter.extendObject(obj._id, obj);
                    mapping[ga.Address] = obj;
                }
            }
        }
    }

    // Establish the eibd connection
    function groupsocketlisten(opts, callback) {
        eibdConnection = eibd.Connection();
        try {
            eibdConnection.socketRemote(opts, function () {
                eibdConnection.openGroupSocket(0, callback);
            });
            throw "connectionError";
        }
        catch (e) {
            if (e == "connectionError")
                adapter.log.error("Connection Error. I'm not able to write to LAN-KNX Gateway ! Check availability of " + adapter.config.gwip);
        } finally {
        }
    }


    parseXml(adapter.config.gaTable, function (error, result) {
        adapter.log.info('parseXml');
        if (result) {
            parseGARange(result.GroupRange);
        }

        // and setup the message parser
        groupsocketlisten({host: adapter.config.gwip, port: adapter.config.gwipport}, function (parser) {

            parser.on('write', function(src, dest, dpt, val){
                if (mapping[dest]) var mappedName = mapping[dest].common.name;
                /* Message received to a GA */
                adapter.log.info('Write from ' + src + ' to ' + '(' + dest + ') ' + mappedName + ': ' + val + ' (' + dpt + ')');
                valtype = dpt;
                // adapter.log.info('====>> ESF File : ' + esf.Name);
                adapter.setState(mappedName + '.' + dest.replace(/\//g, '_'),{val: val, ack: true, from: src});
            });

            parser.on('response', function(src, dest, val) {
                if (mapping[dest]) var mappedName = mapping[dest].common.name;
                adapter.log.info('Response from ' + src + ' to ' + '(' + dest + ') ' + mappedName + ': '+val);
            });

            parser.on('read', function(src, dest) {
                if (mapping[dest]) var mappedName = mapping[dest].common.name;
                adapter.log.info('Read from ' + src + ' to ' + '(' + dest + ') ' + mappedName);
            });

        });
    });

}
