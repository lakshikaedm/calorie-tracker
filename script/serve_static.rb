require "rack"
require "rackup"
require "puma"
require "rack/handler/puma"
root = File.expand_path("../dist", __dir__)
files = Rack::Files.new(root)
app = lambda do |env|
  path = env["PATH_INFO"]
  if path == "/calorie"
    [301, {"location" => "/calorie/"}, []]
  elsif path.start_with?("/calorie/")
    env["PATH_INFO"] = path.delete_prefix("/calorie")
    env["PATH_INFO"] = "/index.html" if env["PATH_INFO"] == "/"
    files.call(env)
  else
    [404, {"content-type" => "text/plain"}, ["Not found"]]
  end
end
Rackup::Handler::Puma.run(app, Host: "127.0.0.1", Port: Integer(ENV.fetch("PORT", "3001")), Silent: true)
