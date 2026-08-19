/**
 * The classic Steve texture, embedded rather than read from disk.
 *
 * This is the last-resort skin: an offline-mode server means plenty of names have no skin on
 * Mojang *or* LittleSkin, and a default Steve reads as "this player never set one" where a
 * generated placeholder reads as "the site is broken".
 *
 * Base64 because the render path runs server-side in a standalone Next build and in Docker,
 * where relative asset paths are the usual thing to get wrong. 64x64, classic (4px) arms.
 */
const BASE64 = [
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAABmJLR0QA/wD/AP+gvaeTAAAHt0lEQVR4nO1aTYwURRT+etM9',
  'OzM9sz0Cyk9WLuCBYBBQAuIS3AQuEg+EsCYYb5J44EDigSPhyAHDwYshBg8L6iZIYkJMEIM/xM0CIpAQIOgF1yEQF7d3unt+',
  'uqE9TFfNq5qenh6m11mS+S5T3fW6ur5X772q6fcUtMHalXkfANIpFZWaB9YGgErNw9imVyOfP3xmUmn3jl5CjSOUTqnIBQpg',
  'bStQBoNdqQnXejqV7EznCQNxhGTC/1gV3jZSqSbyCBRipBa+EmIpwKp5fPVB3IFdP8+IpYAKWX3ZFdDC3J8XF2i7hDTgyYoA',
  'ALMWbupGKgVf85Od7Twgdgyg5p4OYoJV8zCkazBrNQzpGgDwX1/zMWe78zXvxNDWAipStGcBkd2fs10M6RrOT94U5LasW8OV',
  'sZCh0H0eAeFqzcVgqj55dj8nBTxLcgn2DB2HgZ4hqFyl5uHW/VJPzwkDdIKMPLuXTqkwrTIQEGawah53iyW5NCddrbl8HHmH',
  'WJJL8zZ7B73XK6g0mldqHl8dZuqDKQ0fbd+CZS+9CDWbh+eUUK66MM1ZfPbzFFcGchm+yktyaViBEtg9psDBlMYVIB+megFl',
  '7cq8L5uvaZW5CxzcOQLDKCAzWL8uVxuBzTRncfz7S0CwqkYuA0huRF2CKgSBlf32x7+9dwE2cQQTPTC6GQd3jtRJGQXsPXYa',
  'Jy+t5Sv/1ZX12HvsNAyjgGrNxcGdIzgwulkgR8c0rbLgWiBu0Gsor69+wQdZIdMq49CuUUHIMAoAgB+v3QYAvL1xDRBYAMXR',
  'cxdhBK4gB1UE5k/jymBK63kQVFYvS/vMLw+MboaezcJybczZLhbnNXhVBb7m4/zkTax7+RUAwJV7t/Du6BtcZqZU3wpzmg7b',
  'cfDpxSnu69TnmVvR614rQP3grQ38JMfI5zQd0G3MlBoEq5Uabv51D9VKDYPpFN//varCyVuujVxWx4HRzUBwSmQ4NXkDrvcE',
  'ADAwMID333wNAHD4/mRPiDM0aX/rhqPC+fVJ6hsAgGmaAIA7d+5Er9jVq/7E6WMwzVnYjgMEijWMAsb2fYyt+3+IfPzX3w9F',
  'j3/2bGN+to0TF09xFwWAsU++7Mii2p4EGXHDMGIPSskDENpJg5GX3xkXbRXAiDNFLARk83k4pZJwzzAKgiXExbxYAJuI7AKJ',
  'wLZB19k0Z2EYhWe2AGV00wkfAKreYwyqi6BpWd5placxqC7ifQxMxipP4/KHOWFAb8UKwLYxce0c3yYNo4CxjbsAXYdaLIbK',
  'A4BKrMwzDEDXm8hzsL7r10WZ9evF6927I2OCysjHBVVQLjMMYBZKYI5+Ps8nt2/VCE7/WT8l7ls1IpAJkwcAT9frJGXiaEGe',
  '4eHD+u/SpaJs2DgSuAvQFY66J0MplfB0bg5gx8qAgGcYGNs2Bu3u3fpqBn2yvFos1q2ATcg064qgfWGEbLsuGzYppkiqtHYK',
  '6ASuW/c1TctyMgDwdG6uQSCYrJ/P87Zqmk3yT4aHBVIUnmE0mzjtB1l91o6QD0OTAlzX4S7BLIDGAas8zWXDXEcplVqasVIq',
  'IeojmWqaDWsJcGL6Mm/bjgM9mxV+m2Dehp5tuOn+iPchTAHUxzUtKygERBmsPTDkN0x6aKgxUAslDAwNCfIKMXlANHPVNJt2',
  'D3bNtj0W/RnpTnebUBegSqDEWZ/YPyMQpybPTVpShqAoAmH1g2fZNocQcvKfMfl+HGUMIGawawUeyYO2Qg4ogknbNvx8vkk+',
  'FG2CVytizCU6ORSpsr8zsEAHyexbgZJRi8UGcdkaJEXJPk/PBFSZ1BJkUJ/vFGph+U8AgNkH24GIMwGTa8au0JXkBJj56zpA',
  'DjrCM4S0ZxgC+aiVZDGA4VkUoc7MzCCdTgsEdV2HLZmhbduoVCpIp9PQg1W1bRvbvkjxHaKuPAWAFVjUYlS9v3HlPR9usN0p',
  'pRI2fV0/nNVlyri0Z4ZbhUpkcplhYMuN0IlHWURUX5MCAKBSqXByMmnWzyC3qc5poETgRrnMMEbOOLi0p759jpxZjCoeC7Kj',
  '37LdRsGV90oYObMYWiYrkKGrLf8DpFsjtYhWQbKPPvroo48++gDCPosvNGQvXGj5D9phJ00KXUeWnDKdHTsWPMc++uijjz76',
  '6KM3SPyQINcXPC6fBEhydWpqKvqd4+M+/YI88csEb5vmLPZ//l2ic573cu9u0+vFB0WeXU4sw0ww7wp4lvQ6SA3AiuUrYkg/',
  'OxasBbBzPrWA+fjG17U/taovoHkFWl9As0qu6+DiO9PigCy/H5UOp2iT/2+HWOXynYBmjinZsHwD73/4UMzyojkVLiBm6jsO',
  'EldAGNFOUm9qsSjWA4TlGRGv+CHW+xIZhSAOWWolcn7fA4BHj+K/cHxc/F4gfQ+IghMkYrqGXEPEagjClCHXFxw3b4sCQX5f',
  'TniEwXYcHDxypCkGdFIqlZgFUCXQgEeDIULqCxg5RpTu9a3S4nJ/N0gkBsgr3VxDIPblMsPIZYZDZeStjpJkfaY5m9iW+L8E',
  'QUTEhla1fe2ywkmdCrt2gbD6Atd1mla3XX1BVGq7k2xvp+haAXJ9AQKyMuFW9QUy8XYrnzS6VkC39QVAeBxoRzYpq0hkF+im',
  'vgBoXfYWVg8Qdt0N/gOrnkN9cO7m2AAAAABJRU5ErkJggg==',
].join('')

export const STEVE_TEXTURE: Buffer = Buffer.from(BASE64, 'base64')
