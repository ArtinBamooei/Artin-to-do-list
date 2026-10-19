import unittest

from scripts.update_market_rates import extract_quote, parse_number


class TgjuParserTests(unittest.TestCase):
    USD = {"min": 10_000, "max": 100_000_000}

    def test_uses_explicit_current_rate_table_row(self):
        html = """
        <html><head><script>var fake = 'نرخ فعلی: 99999999';</script></head>
        <body><table>
          <tr><td>نرخ فعلی</td><td>2,628,000 -</td></tr>
          <tr><td>زمان ثبت آخرین نرخ</td><td>۲۶ مهر</td></tr>
          <tr><td>نرخ روز گذشته</td><td>2,500,000</td></tr>
        </table></body></html>
        """
        price, source_date = extract_quote(html, self.USD)
        self.assertEqual(price, 2_628_000)
        self.assertEqual(source_date, "26 مهر")

    def test_normalizes_persian_digits_and_arabic_grouping(self):
        self.assertEqual(parse_number("۲٬۶۲۸٬۰۰۰ ریال"), 2_628_000)

    def test_preserves_decimal_oil_quote(self):
        self.assertEqual(parse_number("۱۰۷٫۹۹۷"), 107.997)

    def test_fallback_when_rate_is_outside_table(self):
        html = "<html><body><h2>نرخ فعلی: 2,628,000 -</h2></body></html>"
        self.assertEqual(extract_quote(html, self.USD)[0], 2_628_000)

    def test_rejects_page_without_a_plausible_current_rate(self):
        html = "<html><body><p>نرخ روز گذشته: 2,628,000</p></body></html>"
        with self.assertRaises(ValueError):
            extract_quote(html, self.USD)


if __name__ == "__main__":
    unittest.main()
