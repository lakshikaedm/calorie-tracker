require "selenium-webdriver"
options = Selenium::WebDriver::Chrome::Options.new
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--user-data-dir=#{File.expand_path('../tmp/chrome-smoke', __dir__)}")
driver = Selenium::WebDriver.for(:chrome, options: options)
begin
  driver.navigate.to("http://127.0.0.1:3000")
  sleep 2
  puts driver.title
  puts driver.find_element(id: "remaining-value").text
ensure
  driver.quit
end
