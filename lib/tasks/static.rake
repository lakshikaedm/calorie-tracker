namespace :static do
  desc "Export the shared Rails UI and offline assets to dist/"
  task :build do
    ruby Rails.root.join("script/export.rb").to_s
  end
end
