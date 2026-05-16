class Category {
  const Category({required this.slug, required this.title});

  final String slug;
  final String title;

  factory Category.fromJson(Map<String, dynamic> json) =>
      Category(slug: json['slug'] as String, title: json['title'] as String);
}

class Product {
  const Product({
    required this.id,
    required this.title,
    required this.price,
    required this.categorySlug,
    required this.featured,
  });

  final String id;
  final String title;
  final double price;
  final String categorySlug;
  final bool featured;

  factory Product.fromJson(Map<String, dynamic> json) => Product(
        id: json['id'] as String,
        title: json['title'] as String,
        price: (json['price'] as num).toDouble(),
        categorySlug: json['categorySlug'] as String,
        featured: json['featured'] as bool,
      );
}
