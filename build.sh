#!/bin/bash

IMAGE_URL=ghcr.io/caramelfur/telegram-cooldown

# Exctract version from package.json
VERSION=$(cat package.json | grep version | head -1 | awk -F: '{ print $2 }' | sed 's/[",]//g' | tr -d '[[:space:]]')

echo "Building version $VERSION"

docker build -t $IMAGE_URL:$VERSION -t $IMAGE_URL:latest .

docker push $IMAGE_URL:$VERSION
docker push $IMAGE_URL:latest

echo "Done"
