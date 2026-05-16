import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:sample_shop/data/product_repository.dart';
import 'package:sample_shop/ui/screens/category_detail_screen.dart';

class CategoriesScreen extends StatelessWidget {
  const CategoriesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final repo = context.read<ProductRepository>();
    final cats = repo.categories;
    return ListView.builder(
      itemCount: cats.length,
      itemBuilder: (context, i) {
        final c = cats[i];
        return Semantics(
          identifier: 'categories_list_item_${c.slug}',
          button: true,
          child: ListTile(
            title: Text(c.title),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => CategoryDetailScreen(
                    slug: c.slug, title: c.title),
              ),
            ),
          ),
        );
      },
    );
  }
}
