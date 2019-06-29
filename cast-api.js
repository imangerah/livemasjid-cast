// AUTHOR: Imtiaz Mangerah
//
// Programmatic API for Cast based off https://github.com/vervallsweg/cast-web-api

const Client = require('castv2').Client;
const Castv2Client = require('castv2-client').Client;
const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
const mdns = require('mdns-js');
const debug = require('debug')('cast-api');

let currentRequestId = 1;
const networkTimeout = 10000;
const discoveryTimeout = 4000;
const appLoadTimeout = 10000;

//GOOGLE CAST FUNCTIONS
async function getDevices() {
    let updateCounter = 0;
    const devices = [];
    const browser = mdns.createBrowser(mdns.tcp('googlecast'));
    let exception;

    try {
        browser.on('ready', function(){
            browser.discover();
        });

        browser.on('update', function(service){
                if (service.txt){
                    try {
                        updateCounter++;
                        debug('update received, service: ' + JSON.stringify(service));

                        const currentDevice = {
                            deviceName: getId(service.txt[0]),
                            deviceFriendlyName: getFriendlyName(service.txt),
                            deviceAddress: service.addresses[0],
                            devicePort: service.port
                        };
                        if (!duplicateDevice(devices, currentDevice)&&service.type[0].name!=='googlezone') {
                            devices.push(currentDevice);
                            debug('Added device: '+ JSON.stringify(currentDevice));
                        } else {
                            debug('Duplicat or googlezone device: ' + JSON.stringify(currentDevice))
                        }
                    } catch (e) {
                        console.error('Exception caught while processing service: ' + e);
                    }
                }
        });
    } catch (e) {
        console.error('Exception caught: ' + e);
        exception = e;
    }

    return new Promise(resolve => {
        setTimeout(() => {
            try{browser.stop();} catch (e) {console.error('Exception caught: ' + e); exception=e;}
            if (!exception) {
                if (devices.length>0) {
                    debug('devices.length>0, updateCounter: ' + updateCounter);
                    resolve(JSON.stringify(devices));
                }
            }
            resolve(null);
        }, discoveryTimeout);
    });
}

function getDeviceStatus(address) {
    return new Promise(resolve => {
        let deviceStatus, connection, receiver, exception;
        const client = new Client();
        const corrRequestId = getNewRequestId();

        try {
            debug('getDeviceStatus addr: %a', address);
            client.connect(parseAddress(address), function() {
                connection = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
                receiver   = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');

                connection.send({ type: 'CONNECT' });
                receiver.send({ type: 'GET_STATUS', requestId: corrRequestId });

                receiver.on('message', function(data, broadcast) {
                    if(data.type === 'RECEIVER_STATUS') {
                        if (data.requestId === corrRequestId) {
                            deviceStatus = data;
                            debug('getDeviceStatus recv: %s', JSON.stringify(deviceStatus));
                            resolve(JSON.stringify(deviceStatus));
                        }
                    }
                });
            });
            client.on('error', function(err) {
                console.log(11);

                handleException(err);
                closeClientConnection(client, connection);
                resolve(null);
            });
        } catch (e) {
            console.log(12);

            handleException(e);
            closeClientConnection(client, connection);
            resolve(null);
        }

        setTimeout(() => {
            closeClientConnection(client, connection);
            resolve(null);
        }, networkTimeout);
    });
}

function setDeviceVolume(address, volume) {
    return new Promise(resolve => {
        let deviceStatus, connection, receiver, exception;
        const client = new Client();
        const corrRequestId = getNewRequestId();


        if (address && volume){
            debug('setDeviceVolume addr: %s', address, 'volu:', volume);

            try {
                client.connect(parseAddress(address), function() {
                    connection = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
                    receiver   = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');

                    connection.send({ type: 'CONNECT' });
                    receiver.send({ type: 'SET_VOLUME', volume: { level: volume }, requestId: corrRequestId });

                    receiver.on('message', function(data, broadcast) {
                        if (data.requestId === corrRequestId) {
                            if(data.type === 'RECEIVER_STATUS') {
                                deviceStatus = data;
                                debug('setDeviceVolume recv: %s', JSON.stringify(deviceStatus));
                                resolve(JSON.stringify(deviceStatus));
                            }
                        }
                    });
                });

                client.on('error', function(err) {
                    console.log(13);

                    handleException(err);
                    closeClientConnection(client, connection);
                    resolve(null);
                });
            } catch (e) {
                console.log(14);

                handleException(err);
                closeClientConnection(client, connection);
                resolve(null);
            }
        }

        setTimeout(() => {
            closeClientConnection(client, connection);
            resolve(null);
        }, networkTimeout);
    });
}

function setDeviceMuted(address, muted) { //TODO: Add param error if not boolean
    return new Promise(resolve => {
        let deviceStatus, connection, receiver, exception;
        const client = new Client();
        const corrRequestId = getNewRequestId();

        debug('setDeviceMuted addr: %s', address, 'muted:', muted);
        try {
            client.connect(parseAddress(address), function() {
                connection = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
                receiver   = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');

                connection.send({ type: 'CONNECT' });
                receiver.send({ type: 'SET_VOLUME', volume: { muted: muted }, requestId: corrRequestId });

                receiver.on('message', function(data, broadcast) {
                    if(data.type === 'RECEIVER_STATUS') {
                        if (data.requestId === corrRequestId) {
                            deviceStatus = data;
                            debug('setDeviceMuted recv: %s', JSON.stringify(deviceStatus));
                            resolve(JSON.stringify(deviceStatus));
                        }
                    }
                });
            });
            client.on('error', function(err) {
                console.log(15);

                handleException(err);
                closeClientConnection(client, connection);
                resolve(null);
            });
        } catch (e) {
            console.log(16);

            handleException(err);
            closeClientConnection(client, connection);
            resolve(null);
        }

        setTimeout(() => {
            closeClientConnection(client, connection);
            resolve(null);
        }, networkTimeout);
    });
}

function getMediaStatus(address, sessionId) {
    return new Promise(resolve => {
        let mediaStatus, connection, receiver, media, exception;
        const client = new Client();
        const corrRequestId = getNewRequestId();

        debug('getMediaStatus addr: %s', address, 'seId:', sessionId);
        try {
            client.connect(parseAddress(address), function() {
                connection = client.createChannel('sender-0', sessionId, 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
                media = client.createChannel('sender-0', sessionId, 'urn:x-cast:com.google.cast.media', 'JSON');

                connection.send({ type: 'CONNECT', origin: {} });
                media.send({ type: 'GET_STATUS', requestId: corrRequestId });

                media.on('message', function(data, broadcast) {
                    if(data.type === 'MEDIA_STATUS') {
                        if (data.requestId === corrRequestId) {
                            mediaStatus = data;
                            debug('getMediaStatus recv: %s', JSON.stringify(mediaStatus));
                            resolve(JSON.stringify(mediaStatus));
                        }
                    }
                });
            });

            client.on('error', function(err) {
                console.log(17);

                handleException(err);
                closeClient(client);
                resolve(null);
            });
        } catch (e) {
            console.log(18);

            handleException(err);
            closeClient(client);
            resolve(null);
        }

        setTimeout(() => {
            closeClient(client);
            resolve(null);
        }, networkTimeout);
    });
}

function setMediaPlaybackPause(address, sId, mediaSId) {
    return new Promise(resolve => {
        let mediaStatus, connection, receiver, media, exception;
        const client = new Client();
        const corrRequestId = getNewRequestId();

        debug('setMediaPlaybackPause addr: %s', address, 'seId:', sId, 'mSId:', mediaSId);
        try {
            client.connect(parseAddress(address), function() {
                connection = client.createChannel('sender-0', sId, 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
                media = client.createChannel('sender-0', sId, 'urn:x-cast:com.google.cast.media', 'JSON');

                connection.send({ type: 'CONNECT', origin: {} });
                media.send({ type: 'PAUSE', requestId: corrRequestId, mediaSessionId: mediaSId, sessionId: sId });

                media.on('message', function(data, broadcast) {
                    if(data.type === 'MEDIA_STATUS') {
                        if (data.requestId===corrRequestId||data.requestId===0) {
                            if (data.status[0].playerState==="PAUSED") {
                                mediaStatus = data;
                                debug('setMediaPlaybackPause recv: %s', JSON.stringify(mediaStatus));
                                resolve(JSON.stringify(mediaStatus));
                            }
                        }
                    }
                });
            });

            client.on('error', function(err) {
                handleException(err);
                closeClient(client);
                resolve(null);
            });
        } catch (e) {
            console.log(1);
            handleException(err);
            closeClient(client);
            resolve(null);
        }
        setTimeout(() => {
            closeClient(client);
            resolve(null);
        }, networkTimeout);
    });
}

function setMediaPlaybackPlay(address, sId, mediaSId) {
    return new Promise(resolve => {
        let mediaStatus, connection, receiver, media, exception;
        const client = new Client();
        const corrRequestId = getNewRequestId();

        debug('setMediaPlaybackPlay addr: %s', address, 'seId:', sId, 'mSId:', mediaSId);
        try {
            client.connect(parseAddress(address), function() {
                connection = client.createChannel('sender-0', sId, 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
                media = client.createChannel('sender-0', sId, 'urn:x-cast:com.google.cast.media', 'JSON');

                connection.send({ type: 'CONNECT', origin: {} });
                media.send({ type: 'PLAY', requestId: corrRequestId, mediaSessionId: mediaSId, sessionId: sId });

                media.on('message', function(data, broadcast) {
                    if(data.type === 'MEDIA_STATUS') {
                        if (data.requestId===corrRequestId||data.requestId===0) { //FIX for TuneIn's broken receiver app which always returns with requestId 0
                            if (data.status[0].playerState==="PLAYING") {
                                mediaStatus = data;
                                debug('setMediaPlaybackPlay recv: %s', JSON.stringify(mediaStatus));
                                resolve(JSON.stringify(mediaStatus));
                            }
                        }
                    }
                });
            });

            client.on('error', function(err) {
                console.log(2);

                handleException(err);
                closeClient(client);
                resolve(null);
            });
        } catch (e) {
            console.log(3);

            handleException(err);
            closeClient(client);
            resolve(null);
        }
        setTimeout(() => {
            closeClient(client);
            resolve(null);
        }, networkTimeout);
    });
}

function setDevicePlaybackStop(address, sId) {
    return new Promise(resolve => {
        let deviceStatus, connection, receiver, exception;
        const client = new Client();
        const corrRequestId = getNewRequestId();

        debug('setDevicePlaybackStop addr: %s', address, 'seId:', sId);
        try {
            client.connect(parseAddress(address), function() {
                connection = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
                receiver   = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');

                connection.send({ type: 'CONNECT' });
                receiver.send({ type: 'STOP', sessionId: sId, requestId: corrRequestId });

                receiver.on('message', function(data, broadcast) {
                    if(data.type === 'RECEIVER_STATUS') {
                        if (data.requestId===corrRequestId) {
                            deviceStatus = data;
                            debug('setDevicePlaybackStop recv: %s', JSON.stringify(deviceStatus));
                            resolve(JSON.stringify(deviceStatus));
                        }
                    }
                });
            });

            client.on('error', function(err) {
                console.log(4);

                handleException(err);
                closeClientConnection(client, connection);
                resolve(null);
            });
        } catch (e) {
            console.log(5);

            handleException(err);
            closeClientConnection(client, connection);
            resolve(null);
        }
        setTimeout(() => {
            closeClientConnection(client, connection);
            resolve(null);
        }, networkTimeout);
    });
}

function setMediaPlayback(address, mediaType, mediaUrl, mediaStreamType, mediaTitle, mediaSubtitle, mediaImageUrl, short) {
    return new Promise(resolve => {
        const castv2Client = new Castv2Client();

        castv2Client.connect(parseAddress(address), function() {
            castv2Client.launch(DefaultMediaReceiver, function(err, player) {
                const media = {
                    contentId: mediaUrl,
                    contentType: mediaType,
                    streamType: mediaStreamType,

                    metadata: {
                        type: 0,
                        metadataType: 0,
                        title: mediaTitle,
                        subtitle: mediaSubtitle,
                        images: [
                            {url: mediaImageUrl}
                        ]
                    }
                };

                player.load(media, { autoplay: true }, function(err, status) {
                    if(err){
                        console.log(err);
                        try{player.close();}catch(e){handleException(e);}
                    }
                    else{
                        try{
                            debug('Media loaded playerState: ', status.playerState);
                            if (short===true) {
                                let mediaStatus = JSON.stringify(status);
                                resolve(mediaStatus);
                            }
                        } catch(e){
                            console.log(6);

                            handleException(e);
                            try{player.close();}catch(e){handleException(e);}
                        }
                    }
                });

                player.on('status', function(status) {
                    if (status) {
                        debug('status.playerState: ', status.playerState);
                        if (status.playerState==='PLAYING') {
                            debug('status.playerState is PLAYING');
                            if (player.session.sessionId) {
                                // console.log('Player has sessionId: ', player.session.sessionId);
                                if (short===false) {
                                    getMediaStatus(address, player.session.sessionId).then(mediaStatus => {
                                        debug('getMediaStatus return value: ', mediaStatus);
                                        resolve(mediaStatus);
                                    });
                                }
                            }
                        }
                    }
                });


                setTimeout(() => {
                    closeClient(castv2Client);
                    resolve(null);
                }, appLoadTimeout);
            });
        });

        castv2Client.on('error', function(err) {
            console.log(7);

            handleException(err);
            try{castv2Client.close();}catch(e){handleException(e);}
            resolve(null);
        });
    });
}

function duplicateDevice(devices, device) {
    if (device.deviceName && devices ) {
        for (let i = 0; i < devices.length; i++) {
            if(devices[i].deviceName === device.deviceName) {
                return true;
            }
        }
    }
    return false;
}

function getFriendlyName(serviceTxt) {
    if (!serviceTxt) {
        debug('service.txt is missing');
        return;
    }
    const fns = serviceTxt.filter(function (txt) {
        return txt.match(/fn=*/) != null;
    });
    let fn = "";
    if (fns.length>0) {
        fn=fns[0];
        debug('Is friendly name: ' + fn);
        return (fn.replace(/fn=*/, ''));
    } else {
        debug('Is not friendly name: ' + fn);
    }
}

function getId(id) {
    if (id && id.match(/id=*/)!=null) {
        debug('Is id: ' + id);
        return (id.replace(/id=*/, ''));
    } else {
        debug('Is not id: ' + id);
    }
}

function parseAddress(address){
    let ip=address.split(':')[0];
    let port=address.split(':')[1];

    if (!port) {
        port = 8009;
    }

    debug('IP: '+ip+' port: '+port);

    return {
        host: ip,
        port: port
    };
}

function getNewRequestId(){
    if(currentRequestId > 9998){
        currentRequestId=1;
        debug("Rest currentRequestId");
    }
    debug("getNewRequestId: "+(currentRequestId+1));
    return currentRequestId++;
}

function closeClientConnection(client, connection) {
    closeConnection(connection);
    closeClient(client);
}

function closeConnection(connection) {
    debug('closing connection');
    try {
        connection.send({ type: 'CLOSE' });
    } catch (e) {
        console.log(8);

        handleException(e);
    }
}

function closeClient(client) {
    debug('closing client');
    try {
        client.close();
    } catch (e) {
        console.log(10);

        handleException(e);
    }
}

function handleException(e) {
    console.error('Exception caught: ' + e);
}

module.exports = {
    getDevices,
    getDeviceStatus,
    setDeviceVolume,
    setDeviceMuted,
    getMediaStatus,
    setMediaPlaybackPause,
    setMediaPlaybackPlay,
    setDevicePlaybackStop,
    setMediaPlayback
};