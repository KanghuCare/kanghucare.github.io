#!/bin/sh
# Copy only the public site into public/ for hosting (Cloudflare Pages build step).
# Source pages, build tools, the booking server and project notes stay out of the published site.
set -e
rm -rf public
mkdir -p public
cp *.html robots.txt sitemap.xml site.webmanifest public/
cp -r assets admin public/
echo "published $(find public -type f | wc -l) files to public/"
