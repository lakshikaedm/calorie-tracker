require "fileutils"
ENV["RAILS_ENV"] ||= "production"
ENV["SECRET_KEY_BASE_DUMMY"] ||= "1"
require_relative "../config/environment"
# Render the same Rails view and layout. Relative URLs work at a domain root
# and a GitHub Pages project subdirectory, with no backend in production.
output = Rails.root.join("dist")
FileUtils.mkdir_p(output)
html = ApplicationController.render(template: "tracker/index", layout: "application")
File.write(output.join("index.html"), html)
FileUtils.cp_r(Rails.root.join("public/app"), output)
FileUtils.cp(Rails.root.join("public/manifest.webmanifest"), output)
worker = CalorieAssets.service_worker
File.write(output.join("service-worker.js"), worker)
File.write(output.join(".nojekyll"), "")
File.write(output.join("_headers"), "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/service-worker.js\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n")
puts "Static PWA exported to #{output}. Upload the contents to an HTTPS static host."
