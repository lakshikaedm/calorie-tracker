Rails.application.routes.draw do
  root "tracker#index"
  get "service-worker.js", to: "tracker#service_worker"
  get "up" => "rails/health#show", as: :rails_health_check
end
