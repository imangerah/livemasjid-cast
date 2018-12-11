const cast_api = require('./cast-api');
const debug = require('debug')('livemasjid-cast'); // export DEBUG=livemasjid-cast before running to get debug output
const forEach = require('lodash.foreach');
const axios = require('axios');
const mqtt = require('mqtt')

// CONFIG
let preferred_device = 'Bedroom speaker';
let poll_url = 'http://livemasjid.com:8000/status-json.xsl';

const MILLIS_IN_SECOND = 1000;
const SECONDS_IN_MINUTE = 60;

let poll_interval = 10*MILLIS_IN_SECOND;
let mute_interlock_timeout = 15*SECONDS_IN_MINUTE*MILLIS_IN_SECOND;
let mute_interlock_check_interval = SECONDS_IN_MINUTE*MILLIS_IN_SECOND;
let auto_unmute = true;
let use_mute_interlock = true;

let streams = [
    {
        'name': 'hmjamaat',
        'priority': 1
    },
    {
        'name': 'hma_furqaan',
        'priority': 2
    }
];

// STATE VARIABLES
let mute_interlock = false;
let previous_player_state;

async function handle_message(topic,message,device) {
    if (message === 'started'){
        loadStream(device.deviceAddress,streams.find(x => x.name === topic.split('/')[1]))
    }
}


init_device().then(device => {
    if (device !== undefined) {

    if (use_mute_interlock) {
        setInterlockWhenDeviceIsMuted(device.deviceAddress).catch(err => debug(err));
        setInterval(setInterlockWhenDeviceIsMuted.bind(null, device.deviceAddress), mute_interlock_check_interval);
    }

    let client  = mqtt.connect('mqtt://livemasjid.com:1883');

    client.on('connect', function () {
        for (var i = 0; i < streams.length; i++) {
            client.subscribe("mounts/" + streams[i].name, function (err) {});
        }
    });

    client.on('message', function (topic, message) {
        handle_message(topic,message.toString(),device);
    })


} else {
    debug('No devices available');
}
});

async function setInterlockWhenDeviceIsMuted(playbackAddress) {
    let player_state = await getPlayerState(playbackAddress);

    let previously_muted;
    try {
        previously_muted = previous_player_state.muted;
    } catch (e) {
        previously_muted = false;
    }

    if (mute_interlock === false && previously_muted === false && player_state.muted === true) {

        debug("Setting Mute Interlock");
        mute_interlock = true;

        setTimeout(() => {
            mute_interlock = false;
    }, mute_interlock_timeout);
    }

    previous_player_state = player_state;
}

async function init_device() {

    let devices = JSON.parse(await cast_api.getDevices());
    let selected_device;

    // Default to first device
    if (devices !== undefined && devices.length > 0) {
        selected_device = devices[0];
    }
    // Select preferred device if available
    forEach(devices, device => {
        if (device['deviceFriendlyName'] === preferred_device) {
        debug('Found preferred device: ' + preferred_device);
        selected_device = device;
    }
});

    return selected_device;
}

// Returns the URL and state of the currently playing stream. Returns undefined if none playing or error.
async function getPlayerState(playbackAddress) {

    // get device state
    let status;
    let media_status;
    let current_url;
    let player_state;
    let muted;
    try {
        status = JSON.parse(await cast_api.getDeviceStatus(playbackAddress));
        muted = status.status.volume.muted;
        let sessionId;
        if (status !== undefined) {
            sessionId = status['status']['applications'][0]['sessionId'];

            media_status = JSON.parse(await cast_api.getMediaStatus(playbackAddress, sessionId));

            current_url = media_status.status[0].media.contentId;
            player_state = media_status.status[0].playerState;
        }
    } catch (e) {
        // Expected behaviour when no stream playing
        debug("No stream playing");
    }
    return {
        current_url,
        player_state,
        muted
    }

}

// Loads the highest priority stream available if its not already playing
async function loadStream(playbackAddress,currentStream) {
    let player_state = await getPlayerState(playbackAddress);

    let stream_to_load = await getStreamToLoad(currentStream);

    if (stream_to_load !== undefined) {
        if (player_state.current_url === stream_to_load.listenurl && player_state.player_state === 'PLAYING') {
            debug('Already playing requested stream - skipping')
        } else {
            // Load Stream

            debug('Loading Stream: ' + stream_to_load.listenurl);

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
                let  mediaSessionId = JSON.parse(response)['mediaSessionId'];

                try {
                    let status = JSON.parse(await cast_api.getDeviceStatus(playbackAddress));

                    let sessionId;
                    if (status !== undefined) {
                        sessionId = status['status']['applications'][0]['sessionId'];

                        cast_api.setMediaPlaybackPlay(playbackAddress, sessionId,mediaSessionId);

                        // Auto Unmute if currently muted and config option set and no mute interlock
                        if (auto_unmute === true && mute_interlock === false) {
                            if (player_state.muted === true) {
                                cast_api.setDeviceMuted(playbackAddress, false);
                            }
                        }
                    }
                } catch (e) {
                    debug('Error: ' + e);
                }
            });
        }
    } else {
        debug('No stream found');
    }
    return true;
}

async function getStreamToLoad(currentStream) {
    let response;
    let stream_to_load;

    try {
        response = await axios.get(poll_url).then(response => {

            if (response.status === 200) {
            return response.data;
        } else {
            return undefined;
        }
    });
    } catch (e) {
        debug(e);
    }

    if (response !== undefined) {

        forEach(response.icestats.source, availableStream => {
            let source_url = availableStream.listenurl;
        let stream_name = source_url.substr(source_url.lastIndexOf("/") + 1);

        if (currentStream['name'] === stream_name) {
            if (stream_to_load === undefined || stream_to_load['priority'] > currentStream['priority']) {
                stream_to_load = Object.assign({}, availableStream);
                stream_to_load['priority'] = currentStream['priority'];
            }
        }
    });

    }

    return stream_to_load;
}
