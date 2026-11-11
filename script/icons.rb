# Dependency-free PNG rasterization of our simple vector app mark.
require "zlib"
require "fileutils"
def chunk(type, data)
  [data.bytesize].pack("N") + type + data + [Zlib.crc32(type + data)].pack("N")
end
[192, 512, 180].each do |size|
  pixels = Array.new(size) { Array.new(size) { [36, 131, 103] } }
  # A small leaf inside the maskable safe area.
  size.times do |y|
    size.times do |x|
      u = x.to_f / size; v = y.to_f / size
      leaf = ((u - 0.51) / 0.22)**2 + ((v - 0.46) / 0.26)**2 < 1 && v > 0.18 && u < 0.76
      stem = (u - (0.78 - 0.62 * v)).abs < 0.017 && v.between?(0.39, 0.78)
      vein = (u - (0.78 - 0.62 * v)).abs < 0.014 && v.between?(0.32, 0.65)
      pixels[y][x] = [255, 255, 255] if (leaf && !vein) || stem
    end
  end
  data = pixels.map { |row| "\x00".b + row.flatten.pack("C*") }.join
  png = "\x89PNG\r\n\x1a\n".b + chunk("IHDR", [size,size,8,2,0,0,0].pack("NNC5")) + chunk("IDAT", Zlib.deflate(data)) + chunk("IEND", "")
  name = size == 180 ? "apple-touch-icon.png" : "icon-#{size}.png"
  File.binwrite(File.expand_path("../public/app/#{name}", __dir__), png)
end
