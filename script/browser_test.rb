# Real Chromium checks against Rails and the static build at a nested URL.
require "selenium-webdriver"
require "fileutils"
require "net/http"
require "json"
ROOT = File.expand_path("..", __dir__)
FileUtils.mkdir_p("#{ROOT}/tmp/browser-tests")
FileUtils.mkdir_p("#{ROOT}/test/artifacts")
ENV["SE_CACHE_PATH"] ||= "#{ROOT}/tmp/selenium"
ENV["SE_AVOID_STATS"] = "true"
Selenium::WebDriver.logger.level = :error
rails_port = ENV.fetch("TEST_RAILS_PORT", "3010")
static_port = ENV.fetch("TEST_STATIC_PORT", "3011")
pids=[]
driver=nil
count=0
$stdout.sync=true
begin
  pids << Process.spawn("bundle", "exec", "rails", "server", "-b", "127.0.0.1", "-p", rails_port, "-P", "tmp/pids/browser-test.pid", chdir:ROOT, out:"#{ROOT}/tmp/browser-tests/rails.log", err:[:child,:out])
  pids << Process.spawn({"PORT"=>static_port},"bundle", "exec", "ruby", "script/serve_static.rb", chdir:ROOT, out:"#{ROOT}/tmp/browser-tests/static.log", err:[:child,:out])
  urls=["http://127.0.0.1:#{rails_port}/", "http://127.0.0.1:#{static_port}/calorie/"]
  urls.each do |url|
    deadline=Time.now+30
    loop do
      begin
        break if Net::HTTP.get_response(URI(url)).code=="200"
      rescue Errno::ECONNREFUSED, EOFError
      end
      raise "Server failed to start: #{url}" if Time.now>deadline
      sleep 0.2
    end
  end
  options=Selenium::WebDriver::Chrome::Options.new
  options.add_argument("--headless=new")
  options.add_argument("--no-sandbox")
  options.add_argument("--disable-dev-shm-usage")
  options.add_argument("--window-size=1280,1000")
  options.add_preference("download.default_directory", "#{ROOT}/test/artifacts")
  driver=Selenium::WebDriver.for(:chrome,options:options)
  driver.manage.timeouts.script_timeout=30
  wait=Selenium::WebDriver::Wait.new(timeout:15)
  assert=lambda do |condition,label|
    raise "FAIL: #{label}" unless condition
    count+=1
    puts "PASS #{label}"
  end
  js=lambda{|source,*args|driver.execute_script(source,*args)}
  async=lambda do |source|
    result=driver.execute_async_script("const done=arguments[arguments.length-1];(async()=>{#{source}})().then(v=>done({value:v}),e=>done({error:e.stack}));")
    raise result["error"] if result["error"]
    result["value"]
  end
  field=lambda do |name,value,form="#entry-form"|
    wait.until{js.call("const f=document.querySelector(arguments[0]);return !!f?.elements[arguments[1]] && (!f.closest('dialog') || f.closest('dialog').open)",form,name)}
    js.call("const e=document.querySelector(arguments[0]).elements[arguments[1]];e.value=arguments[2];e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));",form,name,value)
  end
  click=lambda do |selector|
    element=driver.find_element(css:selector)
    driver.execute_script("arguments[0].scrollIntoView({block: \"center\"})",element)
    element.click
    if selector == '#open-settings'
      wait.until{driver.find_element(id:'settings-dialog').attribute('open')}
    elsif selector.include?('data-edit-kind')
      wait.until{driver.find_element(id:'edit-dialog').attribute('open')}
    end
  end
  text=lambda{|selector|js.call("return document.querySelector(arguments[0])?.innerText || ''",selector)}
  urls.each_with_index do |url,index|
    label=index.zero? ? "Rails" : "Static nested path"
    driver.navigate.to(url)
    wait.until{!driver.find_element(id:"today-screen").attribute("hidden")}
    wait.until{js.call("return !!navigator.serviceWorker.controller")}
    assert.call(driver.title.start_with?("Calorie"),"#{label}: launch")
    results=async.call(File.read("#{ROOT}/test/javascript/repository.browser.js"))
    results.each{|r|assert.call(r["pass"],"#{label}: #{r['label']} #{r['error']}")}
    field.call('name','Chicken curry');field.call('portion','200g')
    # Exercise the real copy button with a controlled Clipboard API, then native
    # clipboard where headless Chrome grants access.
    js.call("window.copiedText=null;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.copiedText=t}}})")
    click.call('#copy-estimate')
    wait.until{js.call("return !!window.copiedText")}
    assert.call(js.call("return window.copiedText")=="Calculate roughly the calories and protein in Chicken curry, portion: 200g. Give a reasonable estimate in kcal and grams of protein.","#{label}: copy before calories entered")
    assert.call(js.call("return document.querySelector('#entry-form').elements.calories.value")=='',"#{label}: copy keeps numeric fields intact")
    driver.navigate.refresh
    wait.until{js.call("return document.querySelector('#entry-form').elements.name.value")=='Chicken curry'}
    assert.call(js.call("return document.querySelector('#entry-form').elements.portion.value")=='200g',"#{label}: draft restored after reload")
    origin=URI(url)
    driver.execute_cdp('Browser.grantPermissions',origin:"#{origin.scheme}://#{origin.host}:#{origin.port}",permissions:['clipboardReadWrite','clipboardSanitizedWrite'])
    click.call('#copy-estimate')
    native_copy=async.call('return await navigator.clipboard.readText();')
    assert.call(native_copy.include?('Chicken curry, portion: 200g.'),"#{label}: native Chromium Clipboard API")
    field.call('calories','1000');field.call('protein_grams','25');field.call('local_time','12:40')
    click.call('#submit-entry');wait.until{text.call('#remaining-value')=='800'}
    click.call('[data-kind=workout]');field.call('name','Strength training');field.call('calories','300');field.call('local_time','11:30');click.call('#submit-entry')
    wait.until{text.call('#remaining-value')=='1,100'}
    assert.call(text.call('#protein-total')=='25 g',"#{label}: workout does not change protein")
    click.call('[data-edit-kind=food]');field.call('calories','2000','#edit-form');field.call('protein_grams','35.5','#edit-form');click.call('#edit-form .primary');wait.until{text.call('#remaining-value')=='100'}
    click.call('[data-edit-kind=workout]');field.call('calories_burned','100','#edit-form');click.call('#edit-form .primary');wait.until{text.call('#remaining-value')=='-100'}
    assert.call(text.call('#protein-total')=='35.5 g',"#{label}: edit food and workout recalculates")
    click.call('[data-edit-kind=workout]');click.call('#delete-entry');wait.until{text.call('#remaining-value')=='-200'};click.call('#undo-delete');wait.until{text.call('#remaining-value')=='-100'}
    assert.call(true,"#{label}: deletion and Undo through UI")
    click.call('[data-edit-kind=food]');field.call('local_date','2025-10-14','#edit-form');click.call('#edit-form .primary');wait.until{text.call('#remaining-value')=='1,900'}
    click.call('#nav-history');wait.until{driver.find_elements(css:'.history-day').length==1};click.call('.history-day summary');wait.until{driver.find_elements(css:'.history-day .entry').length==1}
    assert.call(text.call('.history-day').include?('200g') && text.call('.history-day').include?('35.5 g protein'),"#{label}: expandable history with portion and protein")
    click.call('#open-settings');field.call('daily_calorie_goal','2100','#settings-form');field.call('theme','dark','#settings-form');click.call('#settings-form .primary')
    wait.until{js.call("return document.documentElement.dataset.theme")=='dark'}
    wait.until{text.call('.history-totals').include?('1,800')}
    assert.call(true,"#{label}: dark appearance and historical goal preserved")
    click.call('#nav-today');wait.until{text.call('#remaining-value')=='2,200'}
    js.call('window.scrollTo(0,0)')
    driver.save_screenshot("#{ROOT}/test/artifacts/#{index}-desktop-dark.png")
    driver.execute_cdp('Emulation.setDeviceMetricsOverride',width:390,height:844,deviceScaleFactor:1,mobile:true)
    assert.call(js.call('return document.documentElement.scrollWidth<=window.innerWidth'),"#{label}: 390px layout has no horizontal overflow")
    driver.save_screenshot("#{ROOT}/test/artifacts/#{index}-mobile-dark.png")
    click.call('#open-settings');field.call('theme','light','#settings-form');click.call('#settings-form .primary');wait.until{js.call("return document.documentElement.dataset.theme")=='light'}
    driver.save_screenshot("#{ROOT}/test/artifacts/#{index}-mobile-light.png")
    cached=async.call("const keys=await caches.keys();const rows=[];for(const key of keys){const cache=await caches.open(key);rows.push(...(await cache.keys()).map(r=>new URL(r.url).pathname));}return rows;")
    assert.call(cached.any?{|p|p.end_with?('/app/database.js')} && cached.none?{|p|p.include?('backup')},"#{label}: complete shell cached without record backups")
    driver.execute_cdp('Network.enable')
    driver.execute_cdp('Network.emulateNetworkConditions',offline:true,latency:0,downloadThroughput:0,uploadThroughput:0)
    driver.navigate.refresh
    wait.until{text.call('#remaining-value')=='2,200'}
    click.call('[data-kind=food]');field.call('name','Offline banana');field.call('portion','1 banana');field.call('calories','100');field.call('protein_grams','1.5');click.call('#submit-entry');wait.until{text.call('#remaining-value')=='2,100'}
    assert.call(text.call('#protein-total')=='1.5 g',"#{label}: offline launch and food logging")
    click.call('#nav-history');wait.until{driver.find_elements(css:'.history-day').length==1};click.call('.history-day summary');wait.until{driver.find_elements(css:'.history-day .entry').length==1}
    assert.call(text.call('.history-day').include?('Chicken curry'),"#{label}: offline history")
    click.call('.history-day [data-edit-kind=food]');field.call('portion','Half portion','#edit-form');click.call('#edit-form .primary')
    wait.until{text.call('.history-day').include?('Half portion')}
    assert.call(true,"#{label}: offline historical editing")
    click.call('#nav-today');click.call('[data-edit-kind=food]');click.call('#delete-entry')
    wait.until{text.call('#remaining-value')=='2,200'};click.call('#undo-delete');wait.until{text.call('#remaining-value')=='2,100'}
    assert.call(true,"#{label}: offline food deletion and Undo")
    click.call('[data-kind=workout]');field.call('name','Offline walk');field.call('calories','50');click.call('#submit-entry');wait.until{text.call('#remaining-value')=='2,150'}
    assert.call(true,"#{label}: offline workout logging")
    click.call('#open-settings');field.call('daily_calorie_goal','2200','#settings-form');click.call('#settings-form .primary');wait.until{text.call('#remaining-value')=='2,250'}
    assert.call(true,"#{label}: offline settings")
    click.call('#open-settings');click.call('#export-data')
    backup_path="#{ROOT}/test/artifacts/calorie-backup-#{Time.now.strftime('%Y-%m-%d')}.json"
    wait.until{File.exist?(backup_path)}
    exported=JSON.parse(File.read(backup_path))
    assert.call(exported['app']=='Calorie' && exported['foods'].any?{|food|food['name']=='Offline banana'},"#{label}: offline JSON download")
    File.delete(backup_path)
    click.call('#clear-data');wait.until{driver.find_element(id:'confirm-dialog').attribute('open')};click.call('#cancel-clear')
    assert.call(js.call("return document.querySelector('#settings-dialog').open"),"#{label}: clear requires explicit confirmation and can be cancelled")
    click.call('#settings-dialog [data-close]')
    driver.execute_cdp('Network.emulateNetworkConditions',offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1)
    driver.execute_cdp('Emulation.clearDeviceMetricsOverride')
    if index==1
      click.call('[data-kind=food]');field.call('name','Draft across update');field.call('portion','2 slices')
      worker_path="#{ROOT}/dist/service-worker.js"
      original_worker=File.read(worker_path)
      begin
        old_cache=async.call('return await caches.keys();')
        File.write(worker_path,original_worker.sub(/calorie-[a-f0-9]{16}/,'calorie-browser-update'))
        async.call('const r=await navigator.serviceWorker.getRegistration();await r.update();return true;')
        click.call('#open-settings')
        wait.until{driver.find_element(id:'apply-update').displayed?}
        click.call('#apply-update')
        wait.until{js.call("return document.querySelector('#entry-form').elements.name.value")=='Draft across update' && !js.call("return document.querySelector('#settings-dialog').open")}
        wait.until{async.call('return await caches.keys();')!=old_cache}
        assert.call(text.call('#remaining-value')=='2,250',"#{label}: accepted worker update preserves records and draft")
      ensure
        File.write(worker_path,original_worker)
      end
    end
  end
  puts "#{count} browser checks passed. Screenshots in test/artifacts/."
ensure
  driver&.quit
  pids.each{|pid|Process.kill('TERM',pid) rescue nil}
  pids.each{|pid|Process.wait(pid) rescue nil}
end
