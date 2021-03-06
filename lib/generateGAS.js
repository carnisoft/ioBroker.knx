/**
 * Created by KRingmann on 01.09.2016.
 */
// generate JSON-object with complete GAS
/* schema from https://github.com/ioBroker/ioBroker/blob/master/doc/SCHEMA.md#object-types
 // state-working (optional)
 {
 "_id": "adapter.instance.channelName.stateName-working", // e.g. "hm-rpc.0.JEQ0205612:1.WORKING"
 "type": "state",
 "parent": "channel or device",       // e.g. "hm-rpc.0.JEQ0205612:1"
 "common": {
 "name":  "Name of state",        // mandatory, default _id ??
 "def":   false,                  // optional,  default false
 "type":  "boolean",              // optional,  default "boolean"
 "read":  true,                   // mandatory, default true
 "write": false,                  // mandatory, default false
 "min":   false,                  // optional,  default false
 "max":   true,                   // optional,  default true
 "role":  "indicator.working"     // mandatory
 "desc":  ""                      // optional,  default undefined
 }
 }
 */

'use strict';

var admZip = require('adm-zip');
var modRoleObj = require(__dirname + '/dpt2iobroker');
var utils = require(__dirname + '/utils'); // Get common adapter utils

var fs = require('fs');
var select = require('xpath');

var xml2js = require('xml2js');
var xpath = require('xml2js-xpath');
var _ = require('underscore');
var dom = require('xmldom').DOMParser;

var similarity = require('similarity');
var util = require('util');
var extend = require('util')._extend;

var devices = {};
var deviceComObjects = {};
var groupAddresses = {};
var functionOnDevice = {};
var building = {};
var fullGAPath = {};
var dptOfgroupAddress = {
    dpt: '',
    read: '',
    write: '',
    update: '',
    statusGA: ''
};

var propertiesOfGroupAddress = {};

module.exports = {
    // generate the Groupaddress structure
    getGAS: function (fileName, knx_master, callback) {

        if (typeof knx_master === 'function') {
            callback = knx_master;
            knx_master = null;
        }

        var obj = [];

        function processFile(err, knxMaster, xml0) {

            if (err) {
                return callback(err);
            }

            parser.parseString(xml0, function (err, result) {
                var doc = new dom().parseFromString(xml0);

                // map DeviceInstanceRef/@Id => its ComObjectInstanceRefs
                _.each(select.select("//*[local-name(.)='DeviceInstance']", doc), function (device) {
                    var deviceId = device.getAttribute('Id');
                    devices[deviceId] = device;
                    _.each(select.select("./*[local-name(.)='ComObjectInstanceRefs']", device), function (comObjectInstanceRefs) {
                        deviceComObjects[deviceId] = comObjectInstanceRefs;
                    });
                });

                var gaNames = {}; // Name => Id
                var statusGaNames = {}; // Name => Id
                var rePattern = new RegExp(/stat(e|us):*/);

                _.each(select.select("//*[local-name(.)='GroupAddress' and string(@Address)]", doc), function (ga) {
                    var id = ga.getAttribute('Id');
                    groupAddresses[id] = ga;
                    var gaName = ga.getAttribute('Name');
                    propertiesOfGroupAddress[id] = { dpt: ga.getAttribute('DatapointType') };
                    (gaName.toLowerCase().match(rePattern) ? statusGaNames : gaNames)[gaName] = id;
                    var fullPath = gaName.replace(/[\.\s]/g, '_');
                    if (ga.parentNode.nodeName === 'GroupRange') {
                        fullPath = ga.parentNode.getAttribute('Name').replace(/[\.\s]/g, '_') + '.' + fullPath;
                        if (ga.parentNode.parentNode.nodeName === 'GroupRange') {
                            fullPath = ga.parentNode.parentNode.getAttribute('Name').replace(/[\.\s]/g, '_') + '.' + fullPath;
                        }
                    }
                    fullGAPath[ga.getAttribute('Id')] = fullPath;
                });

                // find properties of GroupAddresses based on ComObjects
                _.each(select.select("//*[local-name(.)='Connectors']/*/@GroupAddressRefId", doc), function (grpAddressRefId) {
                    var dpt = grpAddressRefId.ownerElement.parentNode.parentNode.getAttribute('DatapointType');

                    if ( !(dpt === '') && propertiesOfGroupAddress[grpAddressRefId.value] && !(propertiesOfGroupAddress[grpAddressRefId.value].dpt === '') )
                        propertiesOfGroupAddress[grpAddressRefId.value].dpt = dpt;

                    if ( (dpt === '') && propertiesOfGroupAddress[grpAddressRefId.value] && !(propertiesOfGroupAddress[grpAddressRefId.value].dpt === '') )
                        dpt = propertiesOfGroupAddress[grpAddressRefId.value].dpt;

                   // if (!propertiesOfGroupAddress[grpAddressRefId.value] ) {
                        if (grpAddressRefId.ownerElement.nodeName === 'Send') {
                            propertiesOfGroupAddress[grpAddressRefId.value] = {
                                dpt: dpt,
                                read: 'Disabled',
                                write: 'Enabled',
                                update: 'Disabled',
                                //statusGA: ''
                            }
                        }
                        if (grpAddressRefId.ownerElement.nodeName === 'Receive') {
                            propertiesOfGroupAddress[grpAddressRefId.value] = {
                                dpt: dpt,
                                //            read: 'Enabled',
                                //            write: 'Disabled',
                                //            update: 'Enabled',
                                //            statusGA: ''
                            }
                        }
                    //}
                });


                // for each room (or distribution board)...
                _.each(select.select("//*[local-name(.)='DeviceInstanceRef']", doc), function (roomnode) {
                    var location = '';
                    if (roomnode.parentNode.nodeName === 'BuildingPart') {
                        location = roomnode.parentNode.getAttribute('Name');
                        if (roomnode.parentNode.parentNode.nodeName === 'BuildingPart') {
                            location = roomnode.parentNode.parentNode.getAttribute('Name') + '.' + location;
                            if (roomnode.parentNode.parentNode.parentNode.nodeName === 'BuildingPart') {
                                location = roomnode.parentNode.parentNode.parentNode.getAttribute('Name') + '.' + location;
                            }
                        }
                    }
                    building[roomnode.getAttribute('RefId')] = location;

                    _.each(select.select("./*[local-name(.)='DeviceInstanceRef']/@RefId", roomnode.parentNode), function (deviceRefId) {
                        var devicePhysAddr = devices[deviceRefId.value].getAttribute('Address');
                        // for each communication object instance on this device..
                        if (deviceComObjects.hasOwnProperty(deviceRefId.value)) {
                            _.each(select.select("./*[local-name(.)='ComObjectInstanceRef']/*[local-name(.)='Connectors']/*[local-name(.)='Send']/@GroupAddressRefId", deviceComObjects[deviceRefId.value]), function (gaRef) {
                                var ga = groupAddresses[gaRef.value];
                                if (!functionOnDevice[deviceRefId.value])
                                    functionOnDevice[deviceRefId.value] = ga.getAttribute('Id');
                                else
                                    functionOnDevice[deviceRefId.value] = functionOnDevice[deviceRefId.value] + ',' + ga.getAttribute('Id');
                            })
                        }
                    })
                });

                // find control+status pairs
                var statusGroupAddressNames = Object.keys(statusGaNames);
                var controlGroupAddressNames = _.difference(Object.keys(gaNames), statusGroupAddressNames);
                _.each(statusGaNames, function (statusga, statusganame) {
                    var statusgabasename = statusganame.toLowerCase().replace(rePattern, '');
                    var similars = _.max(controlGroupAddressNames, function (otherName) {
                        return similarity(statusgabasename, otherName.toLowerCase());
                    });
                    console.log(statusganame + '( ' + statusgabasename.replace(/' 'stat(e|us):*, ''/) +' )  <=>  ' + similars + '    :  '  + similarity(statusgabasename, similars.toLowerCase()));
                    var sim = similarity(statusgabasename, similars.toLowerCase());
                    if ( sim > 0.7) {
                        console.log('found similars:' + statusgabasename + '  <=>  ' + similars + '     sim: ' + sim);
                        if (propertiesOfGroupAddress[statusga] && propertiesOfGroupAddress[gaNames[similars]]) {

                            if (!(propertiesOfGroupAddress[gaNames[similars]].dpt === '') || ( propertiesOfGroupAddress[statusga] === '')) {
                                if ((propertiesOfGroupAddress[gaNames[similars]].dpt === '') && !( propertiesOfGroupAddress[statusga].dpt === '')) {
                                    propertiesOfGroupAddress[gaNames[similars]].dpt = propertiesOfGroupAddress[statusga].dpt;
                                }
                                if (!(propertiesOfGroupAddress[gaNames[similars]].dpt === '') && ( propertiesOfGroupAddress[statusga] === '')) {
                                    propertiesOfGroupAddress[statusga].dpt = propertiesOfGroupAddress[gaNames[similars]].dpt;
                                }
                            }

                            propertiesOfGroupAddress[gaNames[similars]].statusGA = statusga;
                            propertiesOfGroupAddress[gaNames[similars]].read = 'Disabled';
                            propertiesOfGroupAddress[gaNames[similars]].write = 'Enabled';
                            propertiesOfGroupAddress[gaNames[similars]].update = 'Disabled';

                            propertiesOfGroupAddress[statusga].dpt = propertiesOfGroupAddress[gaNames[similars]].dpt;
                            propertiesOfGroupAddress[statusga].read = 'Enabled';
                            propertiesOfGroupAddress[statusga].write = 'Disabled';
                            propertiesOfGroupAddress[statusga].update = 'Enabled';
                        }
                    }
                });

                var tmpobj = {};

                // generate json object for adapter with iobroker convention
                _.each(groupAddresses, function (groupAddress) {
                    var ga = groupAddress;
                    var id = ga.getAttribute('Id');
                    var gaName = ga.getAttribute('Name');
                    var dpt = "";
                    var fullPath = gaName.replace(/[\.\s]/g, '_');
                    if (ga.parentNode.nodeName === 'GroupRange') {
                        fullPath = ga.parentNode.getAttribute('Name').replace(/[\.\s]/g, '_') + '.' + fullPath;
                        if (ga.parentNode.parentNode.nodeName === 'GroupRange') {
                            fullPath = ga.parentNode.parentNode.getAttribute('Name').replace(/[\.\s]/g, '_') + '.' + fullPath;
                        }
                    }

                    if (propertiesOfGroupAddress[id])
                        dpt = propertiesOfGroupAddress[id].dpt;
/*
                    // needed for dummy devices
                    if (!(propertiesOfGroupAddress[id])) {
                        propertiesOfGroupAddress[id] = {
                            dpt: dpt || '',
                            read: 'Enabled',
                            write: 'Enabled',
                            update: 'Enabled',
                            statusGA: ''
                        }
                        console.log('Create Dummy for ' + id);
                    }
*/
                    var values = setValues(propertiesOfGroupAddress[id]);

                    var roletmp = '';
                    if (values.setType === "") {
                        roletmp = values.setRole;
                    } else {
                        roletmp = values.setRole + '.' + values.setType;
                    }

                    tmpobj = {
                        _id: fullPath,
                        type: 'state',
                        common: {
                            name: gaName,                // mandatory, default _id ??
                            type: values.stateType || values.setType,           // optional,  default "boolean", number, string
                            read: changeValue(propertiesOfGroupAddress[id].read),   // mandatory, default true
                            write: changeValue(propertiesOfGroupAddress[id].write),  // mandatory, default false
                            role: roletmp,              // read-only: indicator.(light, alarm, alarm.water), indicator.motion
                                                        //read-write: state, switch, button, level.(dimmer, blind, rgb.red, rgb.blue, rgb.green, rgb #FFAEEA, hsv.hue, hsv.saturation, hsv.)
                            desc: dpt                   // optional,  default undefined
                        },
                        native: {
                            address: adr2ga(ga.getAttribute('Address')),
                            addressRefId: id,
                            statusGARefId: propertiesOfGroupAddress[id].statusGA || ''
                        }
                    };
                    if (values.setMin !== undefined) tmpobj.common.min = values.setMin;
                    if (values.setMax !== undefined) tmpobj.common.max = values.setMax;
                    obj.push(tmpobj);
                });

                console.log('Done knx_master.xml and 0.xml');
                if (typeof callback === 'function') callback(null, obj);
            });
        }

        if (typeof knx_master === 'string' && typeof fileName === 'string') {
            processFile(null, knx_master, fileName);
        } else {
            loadProjFile(fileName, processFile);
        }
    },

    // generate rooms with functions of com-Object of room-assigned components
    getRoomFunctions: function (fileName, knx_master, callback) {
        if (typeof knx_master === 'function') {
            callback = knx_master;
            knx_master = null;
        }

        function processFile(err, knxMaster, xml0) {

            if (err) {
                return callback(err);
            }
            // generate object of building/projectstructure components
            parser.parseString(xml0, function (err, result) {

                var tmproomObj = {};
                var roomFunctionObj = [];
                var doc = new dom().parseFromString(xml0);
                _.each(select.select("//*[local-name(.)='BuildingPart' and (@Type='Room' or @Type='DistributionBoard' or @Type='Corridor' or @ Type='Stairway')]", doc), function (roomnode) {
                    var tmpFunctionObj = [];
                    tmpFunctionObj.push({rooms: []});
                    tmpFunctionObj.rooms = [];

                    var part = '';
                    var building = '';
                    var room = '';
                    var facility = '';
                    // for each device in that room...
                    _.each(select.select("./*[local-name(.)='DeviceInstanceRef']/@RefId", roomnode), function (deviceRefId) {
                        var devicePhysAddr = devices[deviceRefId.value].getAttribute('Address');
                        var ugNameList = '';
                        // for each communication object instance on this device..
                        if (deviceComObjects.hasOwnProperty(deviceRefId.value)) {
                            _.each(select.select("./*[local-name(.)='ComObjectInstanceRef']/*[local-name(.)='Connectors']/*[local-name(.)='Send']/@GroupAddressRefId", deviceComObjects[deviceRefId.value]), function (gaRef) {
                                var ga = gaRef.value;
                                if (!(ugNameList === '')) {
                                    ugNameList = ugNameList + ',' + gaRef.value;
                                } else {
                                    ugNameList = gaRef.value;
                                }
                            })
                        }

                        building = roomnode.parentNode.parentNode.getAttribute('Name').replace(/[\.\s]/g, '_');
                        part = roomnode.parentNode.getAttribute('Name').replace(/[\.\s]/g, '_');
                        room = roomnode.getAttribute('Name').replace(/[\.\s]/g, '_');
                        facility = '';
                        tmpFunctionObj.rooms.push({room: room, functions: ugNameList});
                        if (!(building === ''))
                            facility = building;

                        if (!(part === '') && !(facility === ''))
                            facility = facility + '.' + part;
                        else
                            facility = part;
                    })
                    tmproomObj = extend({facility: facility, functions: tmpFunctionObj});
                    roomFunctionObj.push(tmproomObj);
                })
                if (typeof callback === 'function') callback(null, roomFunctionObj);
            });
        }

        if (typeof knx_master === 'string' && typeof fileName === 'string') {
            processFile(null, knx_master, fileName);
        } else {
            loadProjFile(fileName, processFile);
        }
    }
};

var parser = new xml2js.Parser();

function loadProjFile(knxProjFileName, callback) {
    var knxMaster;
    var xml0;
    if (fs.existsSync(knxProjFileName)) {
        var zip = new admZip(knxProjFileName);
        var zipEntries = zip.getEntries(); // an array of ZipEntry records
        zipEntries.forEach(function (zipEntry) {
            if (zipEntry.name === 'knx_master.xml') {
                knxMaster = zip.readAsText(zipEntry.entryName) || '';
                console.log('Extracting : ' + zipEntry.name); // outputs zip entries information

                if (knxMaster !== undefined && xml0 !== undefined) {
                    callback(null, knxMaster, xml0)
                }
            }
            if (zipEntry.name === '0.xml') {
                xml0 = zip.readAsText(zipEntry.entryName) || '';
                console.log('Extracting : ' + zipEntry.name); // outputs zip entries information
                if (knxMaster !== undefined && xml0 !== undefined) {
                    callback(null, knxMaster, xml0)
                }
            }
        });
    } else {
        callback('File "' + knxProjFileName + '" not exists');
    }
}

function setValues(propertiesofGA) {
    var roleObj = [];
    var readFlag = propertiesofGA.read;
    var writeFlag = propertiesofGA.write;
    var updateFlag = propertiesofGA.update;
    var dpt = propertiesofGA.dpt;

    roleObj.setDPT = dpt;

    //var setRole;
    var stateFlag = 0;

    if (!readFlag) readFlag = 'Disabled';
    // the update Flag is handled like Read
    // K r w U = > value
    if ((readFlag === 'Disabled' || updateFlag === 'Enabled') && (writeFlag === 'Disabled')) {
        stateFlag = 0;
    }
    // K R w U => value
    if ((readFlag === 'Enabled' || updateFlag === 'Enabled') && (writeFlag === 'Disabled')) {
        stateFlag = 1;
    }

    // K r W U => indicator, level, switch
    if ((readFlag === 'Disabled' || updateFlag === 'Enabled') && (writeFlag === 'Enabled')) {
        stateFlag = 2;
    }

    // K R W U => indicator, level, switch
    if ((readFlag === 'Enabled' || updateFlag === 'Enabled') && (writeFlag === 'Enabled')) {
        stateFlag = 3;
    }

    // K u W u => indicator, level, switch
    if ((readFlag === 'Disabled' || updateFlag === 'Disabled') && (writeFlag === 'Enabled')) {
        stateFlag = 4;
    }

    roleObj = modRoleObj(roleObj, stateFlag);

//    roleObj.setdptName = dptName;
    return roleObj;
}

function changeValue(value) {
    switch (value) {
        case 'Disabled' :
            return false;
        case 'Enabled':
            return true;
    }
}

function adr2ga(adr) {
    return util.format('%d/%d/%d', (adr >>> 11) & 0xf, (adr >> 8) & 0x7, adr & 0xff);
}