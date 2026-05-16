import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sample_shop/ui/widgets/placeholder_image.dart';

void main() {
  testWidgets('same id → same deterministic color', (tester) async {
    final a = colorForId('p001');
    final b = colorForId('p001');
    final c = colorForId('p002');
    expect(a, b);
    expect(a == c, isFalse);

    await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
            body: PlaceholderImage(id: 'p001', label: 'Wireless Earbuds'))));
    expect(find.bySemanticsIdentifier('product_image'), findsOneWidget);
  });
}
