#!/bin/sh
echo "Live Masjid Player"

STREAM=http://livemasjid.com:8000/hma_furqaan

# 24/7 Test stream
# STREAM=http://livemasjid.com:8000/activestream

# Test if mocp is installed
if ! [ -x "$(command -v mocp)" ]; then
  echo 'Error: 'moc' is not installed. Please install using your package manager' >&2
  exit 1
fi

# Test if mocp server is running
mocp -i > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "Server Running"
else
    echo "Server Not Running - Starting"
    mocp -S > /dev/null 2>&1

    # Test if mocp server started
    mocp -i > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "Server Running"

        # Add stream to server
        mocp -c > /dev/null 2>&1
        mocp -a $STREAM > /dev/null 2>&1
    else
        echo "Server failed to start - abort"
        exit 1
    fi
fi


last_stream_seconds=0
count_stopped=0

while :
do
    # Get current status of stream

    mocp -Q "%state" | grep -q 'PLAY'

    if [ $? -eq 0 ]; then
        echo "Stream already playing"

        # Check if stream stopped

        if [ $last_stream_seconds -eq $(mocp -Q "%cs") ]; then
            count_stopped=$((count_stopped+1))
            if [ $count_stopped -eq 3 ]; then
                echo "Stopping Player"
                mocp -s > /dev/null 2>&1
            fi
        else
            count_stopped=0
        fi

        # Get current stream time
        last_stream_seconds=$(mocp -Q "%cs")
        sleep 10
    else
        # Try and start stream
        echo "Attempting to start stream"
        mocp -p > /dev/null 2>&1

        last_stream_seconds=0
        count_stopped=0
        sleep 15

        mocp -Q "%state" | grep -q 'PLAY'

        if [ $? -eq 0 ]; then
            echo "Stream playing"
        else
            # Try and start stream
            echo "Stream not available or failed to start"
        fi

    fi
done