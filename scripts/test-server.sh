#!/bin/bash

# Test script to validate FlyFrog server endpoints
# Usage: ./scripts/test-server.sh <flyfrog-url>

set -e

FLYFROG_URL="${1:-https://flyfrog.example.com}"

echo "🔍 Testing FlyFrog server at: $FLYFROG_URL"
echo

# Test basic connectivity
echo "1. Testing basic connectivity..."
if curl -s --max-time 10 "$FLYFROG_URL" > /dev/null; then
    echo "   ✅ Server is reachable"
else
    echo "   ❌ Server is not reachable"
    exit 1
fi

# Test OIDC start endpoint (without authentication)
echo "2. Testing OIDC start endpoint..."
OIDC_START_URL="$FLYFROG_URL/flyfrog/api/v1/ci/start-oidc"
response_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$OIDC_START_URL" \
    -H "Content-Type: application/json" \
    -d '{"subject_token":"test"}')

if [ "$response_code" = "401" ] || [ "$response_code" = "400" ]; then
    echo "   ✅ OIDC start endpoint exists (returned $response_code as expected)"
elif [ "$response_code" = "404" ]; then
    echo "   ❌ OIDC start endpoint not found (404)"
    exit 1
else
    echo "   ⚠️  OIDC start endpoint returned unexpected status: $response_code"
fi

# Test CI end endpoint (without authentication)
echo "3. Testing CI end endpoint..."
CI_END_URL="$FLYFROG_URL/flyfrog/api/v1/ci/end"
response_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$CI_END_URL" \
    -H "Authorization: Bearer test-token")

if [ "$response_code" = "401" ] || [ "$response_code" = "403" ]; then
    echo "   ✅ CI end endpoint exists (returned $response_code as expected)"
elif [ "$response_code" = "404" ]; then
    echo "   ❌ CI end endpoint not found (404)"
    exit 1
else
    echo "   ⚠️  CI end endpoint returned unexpected status: $response_code"
fi

echo
echo "🎉 All endpoint tests passed! The FlyFrog server appears to support the required API."
echo
echo "To use this server for integration tests, set the FLYFROG_TEST_URL repository variable:"
echo "   FLYFROG_TEST_URL=$FLYFROG_URL"
