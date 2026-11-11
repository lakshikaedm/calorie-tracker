require "digest"
module CalorieAssets
  def self.service_worker
    template = Rails.root.join("app/views/pwa/service-worker.js").read
    paths = Dir[Rails.root.join("public/app/**/*")].select { |path| File.file?(path) }.sort
    paths += [Rails.root.join("public/manifest.webmanifest"), Rails.root.join("app/views/tracker/index.html.erb"), Rails.root.join("app/views/layouts/application.html.erb")]
    digest = Digest::SHA256.new
    digest.update(template)
    paths.each { |path| digest.update(File.binread(path)) }
    template.sub("calorie-v1", "calorie-#{digest.hexdigest[0,16]}")
  end
end
