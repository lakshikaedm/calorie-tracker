require "test_helper"
class TrackerTest < ActionDispatch::IntegrationTest
  test "Rails renders the complete shared shell without a database" do
    get "/"
    assert_response :success
    assert_select "title", "Calorie — Your daily balance"
    assert_select "form#entry-form"
    assert_select "section#history-screen"
    assert_select "dialog#settings-dialog"
    assert_select "script[type=module][src='./app/application.js']"
    assert_not Rails.application.railties.any? { |railtie| railtie.class.name == "ActiveRecord::Railtie" }
  end
  test "health endpoint" do
    get "/up"
    assert_response :success
  end

  test "public worker is valid JavaScript and changes version with app assets" do
    get "/service-worker.js"
    assert_response :success
    assert_equal "application/javascript", response.media_type
    assert_match(/calorie-[a-f0-9]{16}/, response.body)
    assert_includes response.headers["Cache-Control"], "no-cache"
  end
end
