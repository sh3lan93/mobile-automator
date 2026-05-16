import 'package:flutter_test/flutter_test.dart';
import 'package:sample_shop/data/product_repository.dart';
import 'package:sample_shop/main.dart';

void main() {
  testWidgets('SampleShopApp smoke test', (WidgetTester tester) async {
    final repo = ProductRepository();
    await repo.load();
    await tester.pumpWidget(SampleShopApp(repository: repo));
    await tester.pumpAndSettle();
    expect(find.text('Sample Shop'), findsOneWidget);
  });
}
