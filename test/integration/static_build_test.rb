require "test_helper"
require "digest"
require "json"

class StaticBuildTest < ActiveSupport::TestCase
  test "production export is complete, repeatable and removes stale build files" do
    output = Rails.root.join("dist")
    build = lambda do
      assert system({"RAILS_ENV" => "test"}, RbConfig.ruby, Rails.root.join("script/export.rb").to_s, out: File::NULL), "Static export failed"
    end
    build.call
    digest = tree_digest(output)
    File.write(output.join("stale-build-test.txt"), "old generated asset")
    build.call
    assert_not output.join("stale-build-test.txt").exist?
    assert_equal digest, tree_digest(output)

    html = output.join("index.html").read
    assert_includes html, "./app/application.js"
    assert_not_includes html, "<!-- BEGIN app/views"
    manifest = JSON.parse(output.join("manifest.webmanifest").read)
    assert_equal "./", manifest["start_url"]
    assert_equal "./", manifest["scope"]
    manifest["icons"].each { |icon| assert output.join(icon["src"]).file? }
    assert output.join("app/apple-touch-icon.png").file?
    assert_includes output.join("_headers").read, "/*\n  Cache-Control: no-cache"
    assert_equal CalorieAssets.service_worker, output.join("service-worker.js").read
    assert_not Dir[output.join("**/*")].any? { |path| path.match?(/credentials|master\.key|\.rb\z/) }
    shell = JSON.parse(output.join("service-worker.js").read.match(/const FILES = (\[.*?\]);/m)[1].tr("'", '"'))
    shell.reject { |path| path == "./" }.each { |path| assert output.join(path).file?, "Missing shell asset #{path}" }
  end

  private

  def tree_digest(root)
    digest = Digest::SHA256.new
    Dir[root.join("**/*"), root.join(".*")].select { |path| File.file?(path) }.sort.each do |path|
      digest.update(Pathname(path).relative_path_from(root).to_s)
      digest.update(File.binread(path))
    end
    digest.hexdigest
  end
end
