import math
from typing import List, Dict, Optional

DEFAULT_WEIGHTS = {
    "zt_pro": 4,
    "amap_poi": 3,
    "baidu_poi": 3,
    "tian_poi": 3,
    "amap_geo": 2,
    "baidu_geo": 2,
    "tian_geo": 2,
}

VALID_SOURCES = set(DEFAULT_WEIGHTS.keys())


def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    计算两个经纬度点之间的球面物理距离（单位：米）
    """
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lng2 - lng1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


def calculate_spatial_reliability(
    parsers: List[Dict],
    tau: float = 500.0,
    outlier_distance: float = 5000.0,
    weight_config: Optional[Dict[str, int]] = None,
) -> Dict:
    """
    计算多个解析逻辑坐标的综合可靠度

    :param parsers: 解析结果列表，格式如 [{'source': 'zt_pro', 'lat': 31.22, 'lng': 121.48}, ...]
    :param tau: 衰减常数（米）。当加权平均误差等于 tau 时，得分为 e^-1 (约 36.8%)。默认 500米。
    :param outlier_distance: 离群点判定阈值（米）。如果某点与其余所有点的距离都大于该值，将被剔除。
    :param weight_config: 自定义权重配置，格式如 {'zt_pro': 5, 'amap_poi': 3, ...}
    :return: 包含可靠度得分、计算质心、有效解析逻辑集的字典
    """

    if not parsers:
        return {"score": 0.0, "center": None, "msg": "输入数据为空"}

    weights = {**DEFAULT_WEIGHTS, **(weight_config or {})}

    parsed_sources = set()
    normalized_parsers = []

    for p in parsers:
        source = p.get("source", "").lower()
        if source not in VALID_SOURCES:
            continue
        if source in parsed_sources:
            continue

        lat = p.get("lat")
        lng = p.get("lng")
        if lat is None or lng is None:
            continue

        parsed_sources.add(source)
        normalized_parsers.append(
            {
                "source": source,
                "lat": float(lat),
                "lng": float(lng),
                "weight": weights.get(source, 2),
            }
        )

    if not normalized_parsers:
        return {"score": 0.0, "center": None, "msg": "无有效解析数据"}

    if len(normalized_parsers) == 1:
        p = normalized_parsers[0]
        return {
            "score": 1.0,
            "deviation_meters": 0.0,
            "center_lat": round(p["lat"], 6),
            "center_lng": round(p["lng"], 6),
            "valid_sources": [p["source"]],
            "dropped_sources": [],
            "missing_sources": list(VALID_SOURCES - parsed_sources),
            "source_details": [
                {"source": p["source"], "weight_ratio": 1.0, "distance_to_center": 0.0}
            ],
            "msg": "仅有一个有效解析源",
        }

    valid_parsers = []
    dropped_sources = []

    for i, p1 in enumerate(normalized_parsers):
        min_dist_to_others = float("inf")
        for j, p2 in enumerate(normalized_parsers):
            if i == j:
                continue
            dist = haversine_distance(p1["lat"], p1["lng"], p2["lat"], p2["lng"])
            if dist < min_dist_to_others:
                min_dist_to_others = dist

        if min_dist_to_others <= outlier_distance:
            valid_parsers.append(p1)
        else:
            dropped_sources.append(p1["source"])

    if not valid_parsers:
        return {
            "score": 0.0,
            "center": None,
            "valid_sources": [],
            "dropped_sources": dropped_sources,
            "missing_sources": list(VALID_SOURCES - parsed_sources),
            "msg": "所有坐标均严重发散，解析极度不可靠",
        }

    total_weight = sum(p["weight"] for p in valid_parsers)
    if total_weight == 0:
        return {"score": 0.0, "center": None, "msg": "有效点的权重总和为0"}

    for p in valid_parsers:
        p["normalized_weight"] = p["weight"] / total_weight

    center_lat = sum(p["lat"] * p["normalized_weight"] for p in valid_parsers)
    center_lng = sum(p["lng"] * p["normalized_weight"] for p in valid_parsers)

    weighted_avg_deviation = 0.0
    source_details = []

    for p in valid_parsers:
        dist_to_center = haversine_distance(p["lat"], p["lng"], center_lat, center_lng)
        weighted_avg_deviation += p["normalized_weight"] * dist_to_center
        source_details.append(
            {
                "source": p["source"],
                "weight_ratio": round(p["normalized_weight"], 4),
                "distance_to_center": round(dist_to_center, 2),
            }
        )

    reliability_score = math.exp(-weighted_avg_deviation / tau)

    return {
        "score": round(reliability_score, 4),
        "deviation_meters": round(weighted_avg_deviation, 2),
        "center_lat": round(center_lat, 6),
        "center_lng": round(center_lng, 6),
        "valid_sources": [p["source"] for p in valid_parsers],
        "dropped_sources": dropped_sources,
        "missing_sources": list(VALID_SOURCES - parsed_sources),
        "source_details": source_details,
    }


if __name__ == "__main__":
    print("=" * 60)
    print("测试用例1: 所有解析源都有效，d为离群点")
    print("=" * 60)
    test1 = [
        {"source": "zt_pro", "lat": 31.2210, "lng": 121.4810},
        {"source": "amap_poi", "lat": 31.2215, "lng": 121.4812},
        {"source": "baidu_poi", "lat": 31.2205, "lng": 121.4808},
        {"source": "amap_geo", "lat": 31.5000, "lng": 121.5000},
    ]
    result1 = calculate_spatial_reliability(test1)
    print(f"可靠度得分: {result1['score'] * 100:.2f}%")
    print(f"加权平均偏差: {result1['deviation_meters']} 米")
    print(f"质心坐标: ({result1['center_lat']}, {result1['center_lng']})")
    print(f"有效源: {result1['valid_sources']}")
    print(f"被剔除: {result1['dropped_sources']}")
    print(f"缺失源: {result1['missing_sources']}")
    print(f"各源详情: {result1['source_details']}")

    print("\n" + "=" * 60)
    print("测试用例2: 仅3个POI源")
    print("=" * 60)
    test2 = [
        {"source": "zt_pro", "lat": 31.2210, "lng": 121.4810},
        {"source": "amap_poi", "lat": 31.2212, "lng": 121.4811},
        {"source": "baidu_poi", "lat": 31.2208, "lng": 121.4809},
    ]
    result2 = calculate_spatial_reliability(test2)
    print(f"可靠度得分: {result2['score'] * 100:.2f}%")
    print(f"加权平均偏差: {result2['deviation_meters']} 米")
    print(f"有效源: {result2['valid_sources']}")
    print(f"缺失源: {result2['missing_sources']}")

    print("\n" + "=" * 60)
    print("测试用例3: 仅1个源")
    print("=" * 60)
    test3 = [
        {"source": "zt_pro", "lat": 31.2210, "lng": 121.4810},
    ]
    result3 = calculate_spatial_reliability(test3)
    print(f"可靠度得分: {result3['score'] * 100:.2f}%")
    print(f"消息: {result3.get('msg', 'N/A')}")

    print("\n" + "=" * 60)
    print("测试用例4: 全部7个源")
    print("=" * 60)
    test4 = [
        {"source": "zt_pro", "lat": 31.2210, "lng": 121.4810},
        {"source": "amap_poi", "lat": 31.2215, "lng": 121.4812},
        {"source": "baidu_poi", "lat": 31.2205, "lng": 121.4808},
        {"source": "tian_poi", "lat": 31.2212, "lng": 121.4815},
        {"source": "amap_geo", "lat": 31.2200, "lng": 121.4800},
        {"source": "baidu_geo", "lat": 31.2220, "lng": 121.4820},
        {"source": "tian_geo", "lat": 31.2202, "lng": 121.4805},
    ]
    result4 = calculate_spatial_reliability(test4)
    print(f"可靠度得分: {result4['score'] * 100:.2f}%")
    print(f"有效源数量: {len(result4['valid_sources'])}")
    print(f"各源权重比例:")
    for detail in result4["source_details"]:
        print(
            f"  {detail['source']}: {detail['weight_ratio'] * 100:.1f}% (距质心 {detail['distance_to_center']:.1f}m)"
        )

    print("\n" + "=" * 60)
    print("测试用例5: 自定义权重配置")
    print("=" * 60)
    test5 = [
        {"source": "zt_pro", "lat": 31.2210, "lng": 121.4810},
        {"source": "amap_poi", "lat": 31.2215, "lng": 121.4812},
    ]
    custom_weights = {"zt_pro": 10, "amap_poi": 1}
    result5 = calculate_spatial_reliability(test5, weight_config=custom_weights)
    print(f"可靠度得分: {result5['score'] * 100:.2f}%")
    print(f"各源权重比例:")
    for detail in result5["source_details"]:
        print(f"  {detail['source']}: {detail['weight_ratio'] * 100:.1f}%")
