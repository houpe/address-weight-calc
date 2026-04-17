from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import re

app = Flask(__name__)
CORS(app)

ZT_API_BASE = "https://zmap-openapi.gw.zt-express.com"
AMAP_KEY = "2196ccf544e7a8c8f82cff1e40be3992"
BAIDU_AK = "HIM3QorvOGqquDRvLSZ1npMH9lplzcLK"


def normalize_address_text(address):
    """简单清洗地址：去除电话、邮编、多余符号"""
    text = address.strip()
    text = re.sub(r"\d{7,11}", "", text)
    text = re.sub(r"[#＃]", "", text)
    text = re.sub(r"\s+", "", text)
    return text


@app.route("/api/standardize", methods=["POST"])
def standardize():
    data = request.json
    address = data.get("address", "")
    if not address:
        return jsonify({"error": "地址不能为空"}), 400

    clean_addr = normalize_address_text(address)
    try:
        resp = requests.get(
            f"{ZT_API_BASE}/address/standard",
            params={"key": "ztocc", "address": clean_addr, "source": "1"},
            timeout=10,
        )
        result = resp.json()
        formatted = ""
        if result.get("code") == 200 and result.get("data"):
            d = result["data"]
            parts = []
            for key in [
                "provName",
                "cityName",
                "countyName",
                "townName",
                "detailAddress",
            ]:
                val = d.get(key, "")
                if val:
                    parts.append(val)
            formatted = "".join(parts)
        return jsonify({"formatted": formatted or clean_addr, "raw": result})
    except Exception as e:
        return jsonify({"formatted": clean_addr, "error": str(e)})


@app.route("/api/parse", methods=["POST"])
def parse_address():
    data = request.json
    formatted_addr = data.get("formatted", "")
    if not formatted_addr:
        return jsonify({"error": "格式化地址不能为空"}), 400

    results = {}
    city = data.get("city", "")

    # 1. 中通 PRO
    try:
        params = {"address": formatted_addr}
        if city:
            params["city"] = city
        resp = requests.get(
            f"{ZT_API_BASE}/clod/address/search", params=params, timeout=10
        )
        zt_data = resp.json()
        if zt_data.get("code") == 200 and zt_data.get("data"):
            d = zt_data["data"]
            results["zt_pro"] = {
                "lat": float(d.get("latitude", 0)),
                "lng": float(d.get("longitude", 0)),
                "raw": d,
            }
    except Exception as e:
        results["zt_pro"] = {"error": str(e)}

    # 2. 高德 GEO
    try:
        resp = requests.get(
            "https://restapi.amap.com/v3/geocode/geo",
            params={"key": AMAP_KEY, "address": formatted_addr},
            timeout=10,
        )
        amap_data = resp.json()
        if amap_data.get("status") == "1" and amap_data.get("geocodes"):
            gc = amap_data["geocodes"][0]
            loc = gc.get("location", "").split(",")
            if len(loc) == 2:
                results["amap_geo"] = {
                    "lat": float(loc[1]),
                    "lng": float(loc[0]),
                    "raw": gc,
                }
    except Exception as e:
        results["amap_geo"] = {"error": str(e)}

    # 3. 百度 GEO (返回GCJ02坐标)
    try:
        resp = requests.get(
            "https://api.map.baidu.com/geocoding/v3/",
            params={
                "address": formatted_addr,
                "ak": BAIDU_AK,
                "ret_coordtype": "gcj02ll",
                "output": "json",
            },
            timeout=10,
        )
        baidu_data = resp.json()
        if baidu_data.get("status") == 0 and baidu_data.get("result"):
            loc = baidu_data["result"].get("location", {})
            results["baidu_geo"] = {
                "lat": float(loc.get("lat", 0)),
                "lng": float(loc.get("lng", 0)),
                "raw": baidu_data["result"],
            }
    except Exception as e:
        results["baidu_geo"] = {"error": str(e)}

    return jsonify({"formatted": formatted_addr, "parsers": results})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
