import 'package:flutter_test/flutter_test.dart';
import 'package:sample_shop/data/product_repository.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('loads 12 products and 4 categories from bundled assets', () async {
    final repo = ProductRepository();
    await repo.load();

    expect(repo.products.length, 12);
    expect(repo.categories.length, 4);
    expect(repo.products.first.id, 'p001');
    expect(repo.featured().every((p) => p.featured), isTrue);
    expect(repo.byCategory('books').map((p) => p.id),
        containsAll(<String>['p007', 'p008', 'p009']));
  });
}
