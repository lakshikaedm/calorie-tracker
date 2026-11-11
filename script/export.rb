require "fileutils"
require "tmpdir"
require "json"

# A static build must not inherit development/test behavior from the caller.
ENV["RAILS_ENV"] = "production"
ENV["SECRET_KEY_BASE_DUMMY"] = "1"
require_relative "../config/environment"

# Render the existing view and layout; no alternative frontend is maintained.
output = Rails.root.join("dist")
raise "Refusing to replace a symlink at #{output}" if output.symlink?
FileUtils.mkdir_p(Rails.root.join("tmp"))

Dir.mktmpdir("calorie-export-", Rails.root.join("tmp")) do |temporary|
  build = File.join(temporary, "build")
  previous = File.join(temporary, "previous")
  FileUtils.mkdir_p(build)
  html = ApplicationController.render(template: "tracker/index", layout: "application")
  File.write(File.join(build, "index.html"), html)
  FileUtils.cp_r(Rails.root.join("public/app"), build)
  FileUtils.cp(Rails.root.join("public/manifest.webmanifest"), build)
  File.write(File.join(build, "service-worker.js"), CalorieAssets.service_worker)
  File.write(File.join(build, ".nojekyll"), "")
  # Fixed asset URLs are revalidated by HTTP; the versioned worker owns offline
  # caching. These rules apply to / as well as /index.html on Cloudflare Pages.
  File.write(File.join(build, "_headers"), <<~HEADERS)
    /*
      Cache-Control: no-cache
      X-Content-Type-Options: nosniff
      Referrer-Policy: strict-origin-when-cross-origin
  HEADERS

  # Check every explicit shell asset before replacing the last successful build.
  worker = File.read(File.join(build, "service-worker.js"))
  shell = JSON.parse(worker.match(/const FILES = (\[.*?\]);/m)[1].tr("'", '"'))
  shell.each do |relative|
    next if relative == "./"
    raise "Missing offline asset: #{relative}" unless File.file?(File.join(build, relative))
  end

  FileUtils.mv(output, previous) if output.exist?
  begin
    FileUtils.mv(build, output)
  rescue
    FileUtils.mv(previous, output) if File.exist?(previous)
    raise
  end
end
puts "Production static PWA exported to #{output}. Upload this folder's contents to Cloudflare Pages."
