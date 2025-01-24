#!/bin/sh

# Set default MongoDB URI if not already set in the environment
MONGODB_URI=${MONGODB_URI:-"mongodb://muhammed:kilic@mongodb.localhost/sample_namespace"}

# Run the Node.js application
exec node build/index.js "$MONGODB_URI"

# docker run -e MONGODB_URI="mongodb://custom_user:custom_pass@custom_host/custom_namespace" my-app
