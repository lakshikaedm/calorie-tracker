class TrackerController < ApplicationController
  # Public worker code contains no session or personal information.
  skip_forgery_protection only: :service_worker

  def service_worker
    response.headers["Cache-Control"] = "no-cache"
    render plain: CalorieAssets.service_worker, content_type: "application/javascript"
  end

  def index
    response.headers["Cache-Control"] = "no-cache"
  end
end
