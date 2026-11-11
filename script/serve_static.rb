# A file-only preview server. This never loads Rails or defines API endpoints.
require "rack"
require "rackup"
require "puma"
require "rack/handler/puma"

root = File.expand_path("../dist", __dir__)
files = Rack::Files.new(root)
mount = ENV.fetch("STATIC_MOUNT", "").delete_suffix("/")
raise "STATIC_MOUNT must start with /" unless mount.empty? || mount.start_with?("/")

app = lambda do |env|
  path = env["PATH_INFO"]
  if !mount.empty? && path == mount
    [301, {"location" => "#{mount}/"}, []]
  elsif mount.empty? || path.start_with?("#{mount}/")
    env["PATH_INFO"] = path.delete_prefix(mount)
    env["PATH_INFO"] = "/index.html" if env["PATH_INFO"] == "/"
    status, headers, body = files.call(env)
    [status, headers.merge("cache-control" => "no-cache"), body]
  else
    [404, {"content-type" => "text/plain"}, ["Not found"]]
  end
end

port = Integer(ENV.fetch("PORT", "3001"))
puts "Static files only: http://127.0.0.1:#{port}#{mount}/"
$stdout.flush
Rackup::Handler::Puma.run(app, Host: "127.0.0.1", Port: port, Silent: true)
