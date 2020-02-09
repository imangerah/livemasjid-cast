const cast_api = require('./cast-api');
const debug = require('debug')('livemasjid-cast'); // export DEBUG=livemasjid-cast before running to get debug output
const forEach = require('lodash.foreach');
const axios = require('axios');
const mqtt = require('mqtt');

// CONFIG
let preferred_device = 'Living Room speakers';
let restricted_devices = ['Bedside Hub'];
let poll_url = 'http://livemasjid.com:8000/status-json.xsl';

const MILLIS_IN_SECOND = 1000;
const SECONDS_IN_MINUTE = 60;

let stream_active = false;
let poll_interval = 10 * MILLIS_IN_SECOND;
let mute_interlock_timeout = 15 * SECONDS_IN_MINUTE * MILLIS_IN_SECOND;
let mute_interlock_check_interval = SECONDS_IN_MINUTE * MILLIS_IN_SECOND;
let auto_unmute = true;
let use_mute_interlock = true;
let use_stream_volume = true;
let stream_volume = 0.25;
let streams = [
    {
        'name': 'hmjamaat', //activestream',
        'priority': 3
    },
    {
        'name': 'greensidemasjid', //greensidemasjid
        'priority': 2
    },
//    {
//        'name': 'isipingobeachmasjid', //isipingobeachmasjid
//        'priority': 1
//    },
//    {
//        'name': 'hma',
//        'priority': 4
//    }
];

// STATE VARIABLES
let mute_interlock = false;
let previous_player_state;
let pre_stream_volume = 0.8;
let active_stream = "";

let time_debug = function(...args) {
    console.log(new Date().toISOString() + ": ", ...args)
}

async function init_device() {

    let devices = null;
    let selected_device;
    while (!devices){
        time_debug('Searching for devices');
        devices = JSON.parse(await cast_api.getDevices());
        if (devices){
            // Default to first device
            if (devices[0]['deviceFriendlyName'] !== undefined){
                if (restricted_devices.indexOf(devices[0]['deviceFriendlyName']) === -1){
			selected_device = devices[0];
		}
            }
            // Select preferred device if available
            forEach(devices, device => {
                if (device['deviceFriendlyName'] !== undefined){
                    time_debug(device['deviceFriendlyName']);
                    if (device['deviceFriendlyName'] === preferred_device) {
                        time_debug('Found preferred device: ' + preferred_device);
                        selected_device = device;
                    }
                }
            });
            if (!selected_device){
                devices = null;
            }
        }
    }

    time_debug('Device selected: ' + selected_device['deviceFriendlyName']);

    return selected_device;
}


function setVolumeToPreStreamLevel(device,player_state) {
    if ((player_state.volume.level.toFixed(2) === stream_volume.toFixed(2)) && (use_stream_volume === true)) {
        cast_api.setDeviceVolume(device.deviceAddress, pre_stream_volume);
    }
}


async function handle_message(topic, message, device) {
    time_debug(topic,':',message);
    if (message === 'started') {
        loadStream(device.deviceAddress, streams.find(x => x.name === topic.split('/')[1]))
    } else {
        try {
            let player_state = await getPlayerState(device.deviceAddress);
            if (player_state.current_url !== undefined && player_state.current_url !== null) {
                let current_stream_name = player_state.current_url.substr(player_state.current_url.lastIndexOf("/") + 1);
                if (topic.split('/')[1] === active_stream) {
                    stream_active = false;
                    time_debug(active_stream, ' has ended');
                    active_stream = "";
                    cast_api.setDevicePlaybackStop(device.deviceAddress, player_state.sessionId);

                    setVolumeToPreStreamLevel(device,player_state);
                }
            } else {
                if (player_state !== undefined && player_state !== null) {
                    setVolumeToPreStreamLevel(device,player_state);
                } else {

                    time_debug('invalid player state');
                }
            }
        } catch (e) {
            time_debug('failed to re-adjust volume', e);
        }

    }
}


async function setInterlockWhenDeviceIsMuted(playbackAddress) {
    let player_state = await getPlayerState(playbackAddress);

    let previously_muted;
    try {
        previously_muted = previous_player_state.muted;
    } catch (e) {
        previously_muted = false;
    }

    if (mute_interlock === false && previously_muted === false && player_state.muted === true) {

        time_debug("Setting Mute Interlock");
        mute_interlock = true;

        setTimeout(() => {
            mute_interlock = false;
        }, mute_interlock_timeout);
    }

    previous_player_state = player_state;
}



// Returns the URL and state of the currently playing stream. Returns undefined if none playing or error.
async function getPlayerState(playbackAddress) {

    // get device state
    let status;
    let media_status;
    let current_url;
    let player_state;
    let muted;
    let volume;
    let sessionId;
    try {
        status = JSON.parse(await cast_api.getDeviceStatus(playbackAddress));
        muted = status.status.volume.muted;
        volume = status.status.volume;
        if (status !== undefined && status['status'] !== undefined) {
            sessionId = status['status']['applications'][0]['sessionId'];

            media_status = JSON.parse(await cast_api.getMediaStatus(playbackAddress, sessionId));
            if (media_status !== undefined && media_status !== null && media_status.status.length > 0) {
                current_url = media_status.status[0].media.contentId;
                player_state = media_status.status[0].playerState;
            } else {
                current_url = undefined;
                player_state = undefined;
            }

        }
    } catch (e) {
        // Expected behaviour when no stream playing
        time_debug("No stream playing");
    }
    return {
        sessionId,
        current_url,
        player_state,
        muted,
        volume
    }

}

async function getPriorityStream(player_state, currentStream) {
    time_debug('get Priority Stream')
    let stream_to_load = undefined;

    time_debug('Currently playing: ', stream_active,player_state.current_url);

    if (stream_active === false || !player_state.current_url) {
        time_debug('no stream playing, can start new stream');
        stream_active = true;
        pre_stream_volume = (player_state.volume.level || pre_stream_volume).toFixed(2);
        stream_to_load = await getStreamToLoad(currentStream);
    }
    else{
        let current_stream_name = player_state.current_url.substr(player_state.current_url.lastIndexOf("/") + 1,player_state.current_url.length);
        time_debug("current stream priority: ",streams.find(x => x.name === current_stream_name)['priority']);
        time_debug("new stream priority: ",currentStream['priority'])
        if(streams.find(x => x.name === current_stream_name)['priority'] < currentStream['priority']){
            stream_to_load = await getStreamToLoad(currentStream);
        }
        else{
            time_debug('higher priority stream playing');
            stream_to_load = undefined;
        }
    }
    //time_debug(stream_to_load)
    return stream_to_load
}

// Loads the highest priority stream available if its not already playing
async function loadStream(playbackAddress, currentStream) {
    let player_state = await getPlayerState(playbackAddress);
    
    time_debug('currently playing: ',player_state.current_url);
    time_debug('new stream requested: ',currentStream['name']);
    
    let stream_to_load = await getPriorityStream(player_state, currentStream);

    time_debug("Load stream: ", stream_to_load['server_name'])

    if (stream_to_load !== undefined) {
        if (player_state.current_url === stream_to_load.listenurl && player_state.player_state === 'PLAYING') {
            time_debug('Already playing requested stream - skipping')
        } else {
            // Load Stream
            time_debug('Loading Stream: ' + stream_to_load.listenurl)
            active_stream = stream_to_load.listenurl.substr(stream_to_load.listenurl.lastIndexOf("/") + 1);

            cast_api.setMediaPlayback(
                playbackAddress,
                stream_to_load.server_type,
                stream_to_load.listenurl,
                "LIVE",
                stream_to_load.server_name,
                stream_to_load.server_description,
                "https://www.livemasjid.com/images/MasjidLogo.png",
                true
            )
                .then(async response => {
                    if (response !== null) {

                        let mediaSessionId = JSON.parse(response)['mediaSessionId'];

                        try {
                            let status = JSON.parse(await cast_api.getDeviceStatus(playbackAddress));

                            let sessionId;
                            if (status !== undefined && status['status'] !== undefined) {
                                sessionId = status['status']['applications'][0]['sessionId'];

                                cast_api.setMediaPlaybackPlay(playbackAddress, sessionId, mediaSessionId);

                                // Auto Unmute if currently muted and config option set and no mute interlock
                                if (player_state.muted === false && use_stream_volume === true) {
                                    cast_api.setDeviceVolume(playbackAddress, stream_volume);
                                }
                                if (auto_unmute === true && mute_interlock === false) {
                                    if (player_state.muted === true) {
                                        cast_api.setDeviceMuted(playbackAddress, false);
                                    }
                                    if (use_stream_volume === true) {
                                        cast_api.setDeviceVolume(playbackAddress, stream_volume);
                                    }
                                }
                            }
                        } catch (e) {
                            time_debug('Error: ' + e);
                        }
                    } else {
                        time_debug('null response');
                    }
                })
                .catch((e) => {
                    time_debug(e)
                });
        }
    } else {
        time_debug('No stream found');
    }
    return true;
}

async function getStreamToLoad(currentStream) {
    let response;
    let stream_to_load = {
        genre: "Masjid",
        listenurl: "http://livemasjid.com:8000/" + currentStream['name'],
        server_description: "Audio stream " + currentStream['name'],
        server_name: currentStream['name'],
        server_type: "audio/ogg",
        server_url: "www.livemasjid.com:8000/" + currentStream['name']
    }


    // try {
    //     response = await axios.get(poll_url).then(response => {

    //         if (response.status === 200) {
    //         return response.data;
    //     } else {
    //         return undefined;
    //     }
    // });
    // } catch (e) {
    //     time_debug(e);
    // }
    // if (response !== undefined) {

    //     forEach(response.icestats.source, availableStream => {
    //         let source_url = availableStream.listenurl;
    //         let stream_name = source_url.substr(source_url.lastIndexOf("/") + 1);
    //         if (currentStream['name'] === stream_name) {
    //             if (stream_to_load === undefined || stream_to_load['priority'] < currentStream['priority']) {
    //                 stream_to_load = Object.assign({}, availableStream);
    //                 stream_to_load['priority'] = currentStream['priority'];
    //             }
    //         }
    //     });
    //         time_debug('stl',stream_to_load);
    // }

    return stream_to_load;
}


// Main


init_device().then(device => {
    if (device !== undefined) {

        if (use_mute_interlock) {
            setInterlockWhenDeviceIsMuted(device.deviceAddress).catch(err => time_debug(err));
            setInterval(setInterlockWhenDeviceIsMuted.bind(null, device.deviceAddress), mute_interlock_check_interval);
        }

        let client = mqtt.connect('mqtt://livemasjid.com:1883');

        client.on('connect', function () {
            for (let i = 0; i < streams.length; i++) {
                client.subscribe("mounts/" + streams[i].name, function (err) {
                });
            }
        });

        client.on('message', function (topic, message) {
            handle_message(topic, message.toString(), device);
        })


    } else {
        time_debug('No devices available');
	setTimeout(() => {
		throw new Error("No devices available");
	}, 5000)
    }
}).catch((e) => {
    time_debug('error',e)
});
