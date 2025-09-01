#!/bin/bash

ENDPOINT="http://192.168.64.1/api/streams/races/username/data?secret=parser_secret_here"

# Create a temp file that we'll reuse
TEMP_FILE=$(mktemp)

echo "Started sending data to $ENDPOINT"

# Main loop to send data every 5 seconds
while true; do
    # Generate new data
    echo "Generating new data..."
    JSON_DATA=$(gjs -m /usr/local/bin/dump-tree.js)

    # Create the payload and save to temp file
    echo "{\"data\": $JSON_DATA, \"type\": \"ax-tree\", \"platform\": \"linux\"}" > "$TEMP_FILE"

    # Send the data using curl with binary data
    echo "Sending data..."
    curl -X POST \
        -H "Content-Type: application/json" \
        --data-binary @"$TEMP_FILE" \
        "$ENDPOINT"

    echo "Data sent, waiting 1 second..."
    sleep 1
done

rm "$TEMPFILE"