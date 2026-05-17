import 'package:flutter/material.dart';

Color colorForId(String id) {
  var hash = 0;
  for (final code in id.codeUnits) {
    hash = (hash * 31 + code) & 0x7fffffff;
  }
  final hue = (hash % 360).toDouble();
  return HSLColor.fromAHSL(1.0, hue, 0.5, 0.55).toColor();
}

class PlaceholderImage extends StatelessWidget {
  const PlaceholderImage({super.key, required this.id, required this.label});

  final String id;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      identifier: 'product_image',
      label: label,
      child: Container(
        height: 120,
        color: colorForId(id),
        alignment: Alignment.center,
        child: Text(
          label.isEmpty ? '?' : label.characters.first.toUpperCase(),
          style: const TextStyle(
              fontSize: 36, color: Colors.white, fontWeight: FontWeight.bold),
        ),
      ),
    );
  }
}
